import type {
  IExportManager,
  IIntermediateDocumentEngine,
  IJobManager,
  ILayoutEngine,
  IOcrManager,
  IParserEngine,
  IDocumentStructureEngine,
  IGraphicsReconstructionEngine,
  ISemanticStructureEngine,
  IStorageManager,
  ITableDetectionEngine,
  ITelemetryManager,
  ITypographyAnalyzer,
} from '../engines/common/interfaces.js';
import { assembleUnifiedDocument } from '../engines/udm/assemble.js';
import type { RecognitionDocument } from '../engines/ocr/types.js';
import { TERMINAL_STATES } from '../jobs/types.js';

export interface ConversionWorkerDeps {
  jobs: IJobManager;
  storage: IStorageManager;
  parser: IParserEngine;
  ocr: IOcrManager;
  layout: ILayoutEngine;
  idm: IIntermediateDocumentEngine;
  typography: ITypographyAnalyzer;
  semantic: ISemanticStructureEngine;
  table: ITableDetectionEngine;
  graphics: IGraphicsReconstructionEngine;
  structure: IDocumentStructureEngine;
  exporter: IExportManager;
  telemetry: ITelemetryManager;
}

/**
 * Pipeline:
 *   Upload → Parse → OCR/Fusion → Layout → IDM → Typography → Semantic → Tables → Graphics → Structure → UDM → Export
 */
export function createConversionHandler(deps: ConversionWorkerDeps) {
  return async (jobId: string): Promise<void> => {
    const job = await deps.jobs.get(jobId);
    if (!job || TERMINAL_STATES.has(job.state)) return;

    try {
      const original = await deps.storage.get(job.originalStorageKey);
      if (!original) throw new Error('Original PDF missing from storage');

      await deps.jobs.updateState(jobId, 'Parsing', { progress: 12 });
      const raw = await deps.telemetry.time('parser.parse', () =>
        deps.parser.parse(original, {
          pages: job.request.pages,
        }),
      );

      const rawKey = `raw/${jobId}.json`;
      await deps.storage.put(
        rawKey,
        new TextEncoder().encode(JSON.stringify(summarizeRaw(raw))),
      );

      await deps.jobs.updateState(jobId, 'OCR', {
        progress: 25,
        pageCount: raw.pages.length,
        rawDocumentKey: rawKey,
      });

      let afterOcr = raw;
      let recognition: RecognitionDocument | null = null;
      if (deps.ocr.fuse) {
        const fused = await deps.telemetry.time('ocr.fuse', () => deps.ocr.fuse!(raw));
        afterOcr = fused.raw;
        recognition = fused.recognition;
        await deps.storage.put(
          `recognition/${jobId}.json`,
          new TextEncoder().encode(JSON.stringify(summarizeRecognition(recognition))),
        );
      } else {
        afterOcr = await deps.telemetry.time('ocr.process', () => deps.ocr.process(raw));
      }

      await deps.jobs.updateState(jobId, 'LayoutAnalysis', { progress: 40 });
      const layout = await deps.telemetry.time('layout.analyze', () =>
        deps.layout.analyze(afterOcr),
      );

      const layoutKey = `layout/${jobId}.json`;
      await deps.storage.put(
        layoutKey,
        new TextEncoder().encode(JSON.stringify(summarizeLayout(layout))),
      );

      await deps.jobs.updateState(jobId, 'IDMGeneration', { progress: 55 });
      const idm = await deps.idm.build(afterOcr, layout);
      const idmKey = `idm/${jobId}.json`;
      await deps.storage.put(idmKey, new TextEncoder().encode(JSON.stringify(idm)));

      const typography = await deps.telemetry.time('typography.analyze', () =>
        deps.typography.analyze(idm),
      );
      const typoKey = `typography/${jobId}.json`;
      await deps.storage.put(
        typoKey,
        new TextEncoder().encode(JSON.stringify(summarizeTypography(typography))),
      );

      const semantic = await deps.telemetry.time('semantic.generate', () =>
        deps.semantic.generate({ idm, layout, typography }),
      );

      const tableResult = await deps.telemetry.time('table.detect', () =>
        deps.table.detect({ semantic, layout, raw: afterOcr, typography }),
      );
      const enrichedSemantic = tableResult.semantic;

      const semanticKey = `semantic/${jobId}.json`;
      await deps.storage.put(
        semanticKey,
        new TextEncoder().encode(JSON.stringify(summarizeSemantic(enrichedSemantic))),
      );

      const tablesKey = `tables/${jobId}.json`;
      await deps.storage.put(
        tablesKey,
        new TextEncoder().encode(JSON.stringify(summarizeTables(tableResult.tables))),
      );

      const graphicsResult = await deps.telemetry.time('graphics.reconstruct', () =>
        deps.graphics.reconstruct({
          semantic: enrichedSemantic,
          layout,
          raw: afterOcr,
          tables: tableResult,
        }),
      );
      const graphicsKey = `graphics/${jobId}.json`;
      await deps.storage.put(
        graphicsKey,
        new TextEncoder().encode(JSON.stringify(summarizeGraphics(graphicsResult.graphics))),
      );

      const structureResult = await deps.telemetry.time('structure.build', () =>
        deps.structure.build({
          semantic: enrichedSemantic,
          tables: tableResult.tables,
          graphics: graphicsResult.graphics,
          layout,
          raw: afterOcr,
          idm,
        }),
      );
      const structureKey = `structure/${jobId}.json`;
      await deps.storage.put(
        structureKey,
        new TextEncoder().encode(JSON.stringify(summarizeStructure(structureResult.structure))),
      );

      const udm = assembleUnifiedDocument({
        idm,
        semantic: enrichedSemantic,
        tables: tableResult.tables,
        graphics: graphicsResult.graphics,
        structure: structureResult.structure,
        recognition,
        typography,
      });
      await deps.storage.put(
        `udm/${jobId}.json`,
        new TextEncoder().encode(JSON.stringify(summarizeUdm(udm))),
      );

      await deps.jobs.updateState(jobId, 'Export', {
        progress: 80,
        idmKey,
      });

      const pipelineMetrics = {
        pageCount: raw.pages.length,
        objectCount: raw.objectGraph.size,
        styleProfileCount: typography.profiles.length,
        semanticNodeCount: Object.keys(enrichedSemantic.nodes).length,
        tableCount: tableResult.tables.length,
        graphicsCount: graphicsResult.graphics.objects.length,
        bookmarkCount: structureResult.structure.bookmarks.length,
        recognitionPageCount: recognition?.pages.length ?? 0,
      };

      if (deps.exporter.supportedTargets().includes(job.request.target)) {
        const result = await deps.telemetry.time('export.run', () =>
          deps.exporter.export(udm, job.request.target),
        );
        const resultKey = `results/${jobId}.${job.request.target}`;
        await deps.storage.put(resultKey, result.bytes);

        await deps.jobs.updateState(jobId, 'Packaging', { progress: 95, resultStorageKey: resultKey });
        await deps.jobs.updateState(jobId, 'Completed', {
          progress: 100,
          resultStorageKey: resultKey,
          metrics: pipelineMetrics,
        });
        deps.telemetry.info('job.completed', { jobId, target: job.request.target });
      } else {
        await deps.jobs.updateState(jobId, 'Failed', {
          progress: 85,
          idmKey,
          error:
            `Built UDM (${Object.keys(enrichedSemantic.nodes).length} semantic nodes, ` +
            `${tableResult.tables.length} table(s)) but no exporter is registered for ` +
            `"${job.request.target}" yet.`,
          metrics: {
            ...pipelineMetrics,
            characterCount: raw.pages.reduce((n, p) => n + p.characters.length, 0),
            regionCount: layout.pages.reduce((n, p) => n + p.regions.length, 0),
          },
        });
        deps.telemetry.warn('job.export_unavailable', {
          jobId,
          target: job.request.target,
          ...pipelineMetrics,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await deps.jobs.fail(jobId, message);
      deps.telemetry.error('job.failed', { jobId, error: message });
    }
  };
}

function summarizeRaw(raw: {
  id: string;
  pages: Array<{
    index: number;
    width: number;
    height: number;
    characters: unknown[];
    textRuns: unknown[];
    images: unknown[];
    vectors: unknown[];
    annotations: unknown[];
  }>;
  objectGraph: { size: number };
  metadata: unknown;
}): unknown {
  return {
    id: raw.id,
    pageCount: raw.pages.length,
    metadata: raw.metadata,
    objectCount: raw.objectGraph.size,
    pages: raw.pages.map((p) => ({
      index: p.index,
      width: p.width,
      height: p.height,
      characterCount: p.characters.length,
      textRunCount: p.textRuns.length,
      imageCount: p.images.length,
      vectorCount: p.vectors.length,
      annotationCount: p.annotations.length,
    })),
  };
}

function summarizeLayout(layout: {
  id: string;
  sourceDocumentId: string;
  pages: Array<{
    pageIndex: number;
    width: number;
    height: number;
    regions: Array<{
      id: string;
      kind: string;
      confidence: number;
      readingOrderIndex: number;
      bbox: unknown;
      blocks: unknown[];
    }>;
    readingOrder: { order: string[] };
  }>;
}): unknown {
  return {
    id: layout.id,
    sourceDocumentId: layout.sourceDocumentId,
    pageCount: layout.pages.length,
    pages: layout.pages.map((p) => ({
      pageIndex: p.pageIndex,
      width: p.width,
      height: p.height,
      regionCount: p.regions.length,
      readingOrder: p.readingOrder.order,
      regions: p.regions.map((r) => ({
        id: r.id,
        kind: r.kind,
        confidence: r.confidence,
        readingOrderIndex: r.readingOrderIndex,
        bbox: r.bbox,
        blockCount: r.blocks.length,
      })),
    })),
  };
}

function summarizeTypography(typo: {
  id: string;
  sourceDocumentId: string;
  profiles: Array<{ id: string; occurrenceCount: number; clusterKey: string; confidence: number }>;
  statistics: { primaryFonts: unknown; sampleCount: number };
  graph: { nodes: unknown[]; edges: unknown[] };
}): unknown {
  return {
    id: typo.id,
    sourceDocumentId: typo.sourceDocumentId,
    profileCount: typo.profiles.length,
    sampleCount: typo.statistics.sampleCount,
    primaryFonts: typo.statistics.primaryFonts,
    graphEdges: typo.graph.edges.length,
    profiles: typo.profiles.map((p) => ({
      id: p.id,
      occurrenceCount: p.occurrenceCount,
      clusterKey: p.clusterKey,
      confidence: p.confidence,
    })),
  };
}

function summarizeSemantic(semantic: {
  id: string;
  sourceDocumentId: string;
  title?: string;
  readingOrder: string[];
  sections: unknown[];
  nodes: Record<string, { type: string; confidence: number }>;
  quality: unknown;
}): unknown {
  const typeCounts: Record<string, number> = {};
  for (const n of Object.values(semantic.nodes)) {
    typeCounts[n.type] = (typeCounts[n.type] ?? 0) + 1;
  }
  return {
    id: semantic.id,
    sourceDocumentId: semantic.sourceDocumentId,
    title: semantic.title,
    sectionCount: semantic.sections.length,
    readingOrderLength: semantic.readingOrder.length,
    nodeCount: Object.keys(semantic.nodes).length,
    typeCounts,
    quality: semantic.quality,
  };
}

function summarizeTables(
  tables: Array<{
    id: string;
    pageIndex: number;
    kind: string;
    confidence: number;
    rows: unknown[];
    columns: unknown[];
    cells: unknown[];
  }>,
): unknown {
  return {
    tableCount: tables.length,
    tables: tables.map((t) => ({
      id: t.id,
      pageIndex: t.pageIndex,
      kind: t.kind,
      confidence: t.confidence,
      rowCount: t.rows.length,
      columnCount: t.columns.length,
      cellCount: t.cells.length,
    })),
  };
}

function summarizeGraphics(graphics: {
  id: string;
  sourceDocumentId: string;
  objects: Array<{ kind: string; confidence: number }>;
  rootIds: string[];
  resources: { images: Record<string, unknown> };
  quality: unknown;
}): unknown {
  const kindCounts: Record<string, number> = {};
  for (const o of graphics.objects) {
    kindCounts[o.kind] = (kindCounts[o.kind] ?? 0) + 1;
  }
  return {
    id: graphics.id,
    sourceDocumentId: graphics.sourceDocumentId,
    objectCount: graphics.objects.length,
    rootCount: graphics.rootIds.length,
    kindCounts,
    imageResourceCount: Object.keys(graphics.resources.images).length,
    quality: graphics.quality,
  };
}

function summarizeStructure(structure: {
  id: string;
  sourceDocumentId: string;
  headers: unknown[];
  footers: unknown[];
  pageNumbers: unknown[];
  footnotes: unknown[];
  endnotes: unknown[];
  toc: unknown[];
  bookmarks: unknown[];
  hyperlinks: unknown[];
  root: { childIds: string[] };
  quality: unknown;
}): unknown {
  return {
    id: structure.id,
    sourceDocumentId: structure.sourceDocumentId,
    headerCount: structure.headers.length,
    footerCount: structure.footers.length,
    pageNumberCount: structure.pageNumbers.length,
    footnoteCount: structure.footnotes.length,
    endnoteCount: structure.endnotes.length,
    tocEntryCount: structure.toc.length,
    bookmarkCount: structure.bookmarks.length,
    hyperlinkCount: structure.hyperlinks.length,
    sectionChildCount: structure.root.childIds.length,
    quality: structure.quality,
  };
}

function summarizeRecognition(recognition: RecognitionDocument): unknown {
  return {
    id: recognition.id,
    sourceDocumentId: recognition.sourceDocumentId,
    primaryLanguage: recognition.primaryLanguage,
    pageCount: recognition.pages.length,
    pages: recognition.pages.map((p) => ({
      pageIndex: p.pageIndex,
      kind: p.kind,
      ocrApplied: p.ocrApplied,
      blockCount: p.blocks.length,
      wordCount: p.words.length,
      confidence: p.confidence.page,
    })),
    quality: recognition.quality,
  };
}

function summarizeUdm(udm: {
  id: string;
  version: string;
  metadata: unknown;
  tables: unknown[];
  graphics: { objects: unknown[] } | null;
  structure: { bookmarks: unknown[] } | null;
  recognition: { pages: unknown[] } | null;
  semantic: { nodes: Record<string, unknown> };
}): unknown {
  return {
    id: udm.id,
    version: udm.version,
    metadata: udm.metadata,
    semanticNodeCount: Object.keys(udm.semantic.nodes).length,
    tableCount: udm.tables.length,
    graphicsCount: udm.graphics?.objects.length ?? 0,
    bookmarkCount: udm.structure?.bookmarks.length ?? 0,
    recognitionPageCount: udm.recognition?.pages.length ?? 0,
  };
}
