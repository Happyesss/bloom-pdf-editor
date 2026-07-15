import { createId } from '../../utils/id.js';
import type { IntermediateDocument } from '../idm/types.js';
import type { LayoutDocument } from '../layout/types.js';
import type { TypographyAnalysis } from '../typography/types.js';
import {
  bodyMedianFontSize,
  detectCaption,
  detectCodeBlock,
  detectHeading,
  detectImage,
  detectList,
  detectQuote,
  isNearImage,
  makeParagraph,
  type BlockContext,
} from './detectors.js';
import type {
  SemanticDocument,
  SemanticHyperlink,
  SemanticNode,
  SemanticQualityScores,
  SemanticSection,
} from './types.js';

export interface SemanticEngineInput {
  idm: IntermediateDocument;
  layout?: LayoutDocument | null;
  typography: TypographyAnalysis;
}

/**
 * Phase 6 — Semantic Structure & Paragraph Reconstruction Engine.
 * No table detection, no export, no OCR.
 */
export class SemanticStructureEngine {
  readonly name = 'SemanticStructureEngine' as const;

  async generate(input: SemanticEngineInput): Promise<SemanticDocument> {
    return this.GenerateSemanticModel(input);
  }

  GenerateSemanticModel(input: SemanticEngineInput): SemanticDocument {
    const { idm, layout, typography } = input;
    const medianSize = bodyMedianFontSize(idm, typography);
    const contentNodes: SemanticNode[] = [];
    const nodes: Record<string, SemanticNode> = {};

    for (const page of idm.sections.flatMap((s) => s.pages)) {
      const blocks = [...page.blocks].sort(
        (a, b) => a.readingOrderIndex - b.readingOrderIndex,
      );

      for (const block of blocks) {
        const profileId = typography.typographyMap.blockToProfile[block.id];
        const styleProfile = typography.profiles.find((p) => p.id === profileId);

        const ctx: BlockContext = {
          block,
          pageIndex: page.index,
          pageWidth: page.width,
          pageHeight: page.height,
          styleProfile,
          bodyMedianFontSize: medianSize,
          layoutNearImage: isNearImage(block, layout, page.index),
        };

        const node = classifyBlock(ctx);
        contentNodes.push(node);
        nodes[node.id] = node;
        // Nested list items
        if (node.type === 'list') {
          for (const item of node.items) {
            nodes[item.id] = item;
          }
        }
      }
    }

    // Merge consecutive list items into single lists
    const merged = mergeAdjacentLists(contentNodes, nodes);

    // Hyperlinks from IDM
    for (const link of idm.hyperlinks) {
      const hn: SemanticHyperlink = {
        id: createId('slink'),
        type: 'hyperlink',
        parentId: null,
        childIds: [],
        readingOrderIndex: 10_000 + link.pageIndex,
        confidence: 0.9,
        pageIndex: link.pageIndex,
        bbox: link.bbox,
        sourceBlockIds: link.sourceObjectId ? [link.sourceObjectId] : [],
        uri: link.uri,
        text: link.text,
      };
      nodes[hn.id] = hn;
    }

    const sections = this.BuildSemanticTree(merged, nodes);
    const readingOrder = merged.map((n) => n.id);

    // Attach section parents
    for (const section of sections) {
      nodes[section.id] = section;
      for (const childId of section.childIds) {
        const child = nodes[childId];
        if (child) child.parentId = section.id;
      }
    }

    const quality = scoreQuality(merged);
    const titleNode = merged.find((n) => n.type === 'title');

    return {
      id: createId('semantic'),
      sourceDocumentId: idm.id,
      sourceLayoutId: layout?.id,
      typographyAnalysisId: typography.id,
      title: titleNode && 'text' in titleNode ? titleNode.text : idm.metadata.title,
      sections,
      readingOrder,
      nodes,
      quality,
    };
  }

  DetectHeadings(doc: SemanticDocument): SemanticNode[] {
    return Object.values(doc.nodes).filter(
      (n) => n.type === 'heading' || n.type === 'title' || n.type === 'subtitle',
    );
  }

  DetectLists(doc: SemanticDocument): SemanticNode[] {
    return Object.values(doc.nodes).filter((n) => n.type === 'list');
  }

  ReconstructParagraphs(doc: SemanticDocument): SemanticNode[] {
    return Object.values(doc.nodes).filter((n) => n.type === 'paragraph');
  }

  BuildSemanticTree(
    content: SemanticNode[],
    _nodes: Record<string, SemanticNode>,
  ): SemanticSection[] {
    const sections: SemanticSection[] = [];
    let current: SemanticSection | null = null;

    const startSection = (heading?: SemanticNode) => {
      const section: SemanticSection = {
        id: createId('ssec'),
        type: 'section',
        parentId: null,
        childIds: [],
        children: [],
        readingOrderIndex: heading?.readingOrderIndex ?? sections.length,
        confidence: heading ? heading.confidence : 0.6,
        pageIndex: heading?.pageIndex ?? content[0]?.pageIndex ?? 0,
        sourceBlockIds: heading?.sourceBlockIds ?? [],
        title: heading && 'text' in heading ? String(heading.text) : undefined,
        headingId: heading?.id,
      };
      if (heading) {
        heading.parentId = section.id;
        section.childIds.push(heading.id);
        section.children.push(heading);
      }
      sections.push(section);
      current = section;
      return section;
    };

    if (content.length === 0) {
      startSection();
      return sections;
    }

    for (const node of content) {
      if (node.type === 'title' || node.type === 'heading') {
        // H1 / title starts a new top-level section
        if (node.type === 'title' || (node.type === 'heading' && node.level <= 2)) {
          startSection(node);
          continue;
        }
        // Deeper headings → subsection under current
        if (!current) startSection();
        const sub: SemanticSection = {
          id: createId('ssub'),
          type: 'subsection',
          parentId: current!.id,
          childIds: [node.id],
          children: [node],
          readingOrderIndex: node.readingOrderIndex,
          confidence: node.confidence,
          pageIndex: node.pageIndex,
          sourceBlockIds: node.sourceBlockIds,
          title: 'text' in node ? String(node.text) : undefined,
          headingId: node.id,
        };
        node.parentId = sub.id;
        current!.childIds.push(sub.id);
        current!.children.push(sub);
        // Subsequent paras go to current (parent section) — simplify: attach to subsection
        current = sub;
        continue;
      }

      if (!current) startSection();
      node.parentId = current!.id;
      current!.childIds.push(node.id);
      current!.children.push(node);
    }

    return sections.filter((s) => s.type === 'section' || s.parentId == null);
  }
}

function classifyBlock(ctx: BlockContext): SemanticNode {
  const image = detectImage(ctx);
  if (image) return image;

  const list = detectList(ctx);
  if (list) return list;

  const code = detectCodeBlock(ctx);
  if (code) return code;

  const caption = detectCaption(ctx);
  if (caption) return caption;

  const quote = detectQuote(ctx);
  if (quote) return quote;

  const heading = detectHeading(ctx);
  if (heading) return heading;

  return makeParagraph(ctx);
}

function mergeAdjacentLists(
  nodes: SemanticNode[],
  nodeMap: Record<string, SemanticNode>,
): SemanticNode[] {
  const out: SemanticNode[] = [];
  for (const node of nodes) {
    const prev = out[out.length - 1];
    if (
      node.type === 'list' &&
      prev?.type === 'list' &&
      prev.listStyle === node.listStyle &&
      prev.pageIndex === node.pageIndex
    ) {
      for (const item of node.items) {
        item.parentId = prev.id;
        prev.items.push(item);
        prev.childIds.push(item.id);
        prev.sourceBlockIds.push(...item.sourceBlockIds);
        nodeMap[item.id] = item;
      }
      delete nodeMap[node.id];
      continue;
    }
    out.push(node);
  }
  return out;
}

function scoreQuality(nodes: SemanticNode[]): SemanticQualityScores {
  const avg = (type: SemanticNode['type']) => {
    const list = nodes.filter((n) => n.type === type);
    if (list.length === 0) return 0.5;
    return list.reduce((s, n) => s + n.confidence, 0) / list.length;
  };

  const heading = Math.max(
    avg('heading'),
    avg('title'),
    avg('subtitle'),
  );
  const paragraph = avg('paragraph');
  const list = avg('list');
  const caption = avg('caption');
  const quote = avg('quote');
  const codeBlock = avg('code_block');
  const section = 0.7;
  const overall =
    heading * 0.15 +
    paragraph * 0.35 +
    list * 0.15 +
    caption * 0.1 +
    quote * 0.05 +
    codeBlock * 0.05 +
    section * 0.15;

  return { heading, paragraph, list, caption, quote, codeBlock, section, overall };
}
