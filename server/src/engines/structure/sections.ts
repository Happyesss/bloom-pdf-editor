import { createId } from '../../utils/id.js';
import type { ISectionHierarchyBuilder, StructureEngineInput } from './algorithms/types.js';
import type { StructureNode, StructureNodeKind } from './types.js';

/**
 * Build Document → Part → Chapter → Section → Subsection hierarchy
 * from semantic sections/headings.
 */
export class SectionHierarchyBuilder implements ISectionHierarchyBuilder {
  readonly name = 'SectionHierarchyBuilder';

  build(input: StructureEngineInput): {
    root: StructureNode;
    nodes: Record<string, StructureNode>;
  } {
    const nodes: Record<string, StructureNode> = {};
    const root: StructureNode = {
      id: createId('sdoc'),
      kind: 'document',
      title: input.semantic.title ?? input.idm.metadata.title,
      parentId: null,
      childIds: [],
      semanticNodeIds: [],
      confidence: 0.9,
    };
    nodes[root.id] = root;

    const headings = Object.values(input.semantic.nodes)
      .filter((n) => n.type === 'heading' || n.type === 'title' || n.type === 'subtitle')
      .sort((a, b) => a.readingOrderIndex - b.readingOrderIndex);

    // Stack of open parents by depth
    const stack: StructureNode[] = [root];

    for (const h of headings) {
      const level = headingLevel(h);
      const kind = kindForLevel(level);
      while (stack.length > 1 && depthOf(stack[stack.length - 1]!) >= level) {
        stack.pop();
      }
      const parent = stack[stack.length - 1]!;
      const node: StructureNode = {
        id: createId('snode'),
        kind,
        title: 'text' in h ? String(h.text ?? '') : undefined,
        pageIndex: h.pageIndex,
        parentId: parent.id,
        childIds: [],
        semanticNodeIds: [h.id],
        confidence: h.confidence,
      };
      nodes[node.id] = node;
      parent.childIds.push(node.id);
      stack.push(node);
    }

    // Attach semantic sections as nodes if no headings produced structure
    if (root.childIds.length === 0 && input.semantic.sections.length) {
      for (const sec of input.semantic.sections) {
        const node: StructureNode = {
          id: createId('snode'),
          kind: sec.type === 'subsection' ? 'subsection' : 'section',
          title: sec.title,
          parentId: root.id,
          childIds: [],
          semanticNodeIds: [sec.id, ...sec.childIds],
          confidence: sec.confidence,
        };
        nodes[node.id] = node;
        root.childIds.push(node.id);
      }
    }

    // Wire previous/next among root children
    const kids = root.childIds.map((id) => nodes[id]!);
    for (let i = 0; i < kids.length; i++) {
      if (i > 0) kids[i]!.previousId = kids[i - 1]!.id;
      if (i < kids.length - 1) kids[i]!.nextId = kids[i + 1]!.id;
    }

    return { root, nodes };
  }
}

function headingLevel(n: { type: string; level?: number }): number {
  if (n.type === 'title') return 1;
  if (n.type === 'subtitle') return 2;
  if (typeof n.level === 'number') return Math.min(6, Math.max(1, n.level));
  return 2;
}

function kindForLevel(level: number): StructureNodeKind {
  if (level <= 1) return 'chapter';
  if (level === 2) return 'section';
  if (level === 3) return 'subsection';
  return 'subsection';
}

function depthOf(n: StructureNode): number {
  switch (n.kind) {
    case 'document':
      return 0;
    case 'part':
      return 1;
    case 'chapter':
      return 1;
    case 'section':
      return 2;
    case 'subsection':
      return 3;
    default:
      return 4;
  }
}
