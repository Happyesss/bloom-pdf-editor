import { createId } from '../../utils/id.js';
import type { GraphicsModel } from '../graphics/types.js';
import type { IntermediateDocument } from '../idm/types.js';
import type { LayoutDocument } from '../layout/types.js';
import type { RawDocument } from '../parser/raw-model.js';
import type { SemanticDocument } from '../semantic/types.js';
import type { LogicalTable } from '../table/types.js';
import { createDefaultStructureStrategies } from './algorithms/defaults.js';
import type { StructureEngineInput, StructureStrategies } from './algorithms/types.js';
import type {
  DocumentStructureModel,
  DocumentStructureResult,
  FootnoteEntry,
  RunningRegion,
  TocEntry,
} from './types.js';

export interface DocumentStructureEngineOptions {
  strategies?: Partial<StructureStrategies>;
}

/**
 * Phase 9 — Document Structure Intelligence Engine.
 * Document-wide structures spanning pages. Format-independent. No export/OCR.
 */
export class DocumentStructureEngine {
  readonly name = 'DocumentStructureEngine' as const;
  private readonly strategies: StructureStrategies;

  constructor(options: DocumentStructureEngineOptions = {}) {
    const defaults = createDefaultStructureStrategies();
    this.strategies = { ...defaults, ...options.strategies };
  }

  async build(input: {
    semantic: SemanticDocument;
    tables?: LogicalTable[];
    graphics?: GraphicsModel | null;
    layout?: LayoutDocument | null;
    raw: RawDocument;
    idm: IntermediateDocument;
  }): Promise<DocumentStructureResult> {
    return this.BuildDocumentStructure(input);
  }

  DetectHeaders(input: StructureEngineInput): RunningRegion[] {
    return this.strategies.running.detectHeaders(input);
  }

  DetectFooters(input: StructureEngineInput): RunningRegion[] {
    return this.strategies.running.detectFooters(input);
  }

  DetectFootnotes(input: StructureEngineInput): {
    footnotes: FootnoteEntry[];
    endnotes: FootnoteEntry[];
  } {
    return this.strategies.footnotes.detect(input);
  }

  DetectTOC(input: StructureEngineInput): TocEntry[] {
    return this.strategies.toc.detect(input);
  }

  BuildDocumentStructure(input: {
    semantic: SemanticDocument;
    tables?: LogicalTable[];
    graphics?: GraphicsModel | null;
    layout?: LayoutDocument | null;
    raw: RawDocument;
    idm: IntermediateDocument;
  }): DocumentStructureResult {
    const ctx: StructureEngineInput = {
      semantic: input.semantic,
      tables: input.tables ?? [],
      graphics: input.graphics ?? null,
      layout: input.layout ?? null,
      raw: input.raw,
      idm: input.idm,
    };

    const headers = this.DetectHeaders(ctx);
    const footers = this.DetectFooters(ctx);
    const pageNumbers = this.strategies.pageNumbers.detect(ctx, footers);
    const { footnotes, endnotes } = this.DetectFootnotes(ctx);
    const toc = this.DetectTOC(ctx);
    const bookmarks = this.strategies.bookmarks.build(ctx);
    const hyperlinks = this.strategies.hyperlinks.analyze(ctx);
    const { root, nodes } = this.strategies.sections.build(ctx);

    const meta = input.idm.metadata;
    const structure: DocumentStructureModel = {
      id: createId('structure'),
      sourceDocumentId: input.raw.id,
      metadata: {
        title: meta.title ?? input.semantic.title,
        author: meta.author,
        subject: meta.subject,
        keywords: meta.keywords,
        language: meta.language,
        creationDate: meta.creationDate,
        modificationDate: meta.modificationDate,
        producer: meta.producer,
        creator: meta.creator,
      },
      headers,
      footers,
      pageNumbers,
      footnotes,
      endnotes,
      toc,
      bookmarks,
      hyperlinks,
      root,
      nodes,
      quality: {
        headers: avg(headers.map((h) => h.confidence)),
        footers: avg(footers.map((f) => f.confidence)),
        pageNumbers: avg(pageNumbers.map((p) => p.confidence)),
        footnotes: avg([...footnotes, ...endnotes].map((f) => f.confidence)),
        toc: avg(toc.map((t) => t.confidence)),
        bookmarks: avg(flattenBookmarks(bookmarks).map((b) => b.confidence)),
        crossReferences: avg(
          hyperlinks.filter((h) => h.kind === 'cross_reference').map((h) => h.confidence),
        ),
        overall: 0,
      },
    };

    structure.quality.overall =
      structure.quality.headers * 0.15 +
      structure.quality.footers * 0.1 +
      structure.quality.pageNumbers * 0.1 +
      structure.quality.footnotes * 0.1 +
      structure.quality.toc * 0.15 +
      structure.quality.bookmarks * 0.2 +
      structure.quality.crossReferences * 0.1 +
      0.1;

    return {
      id: createId('sresult'),
      structure,
    };
  }
}

function avg(nums: number[]): number {
  if (!nums.length) return 0.5;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function flattenBookmarks(
  nodes: Array<{ confidence: number; children: unknown[] }>,
): Array<{ confidence: number; children: unknown[] }> {
  const out: Array<{ confidence: number; children: unknown[] }> = [];
  for (const n of nodes) {
    out.push(n);
    out.push(
      ...flattenBookmarks(n.children as Array<{ confidence: number; children: unknown[] }>),
    );
  }
  return out;
}
