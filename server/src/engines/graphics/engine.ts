import { createId } from '../../utils/id.js';
import type { LayoutDocument } from '../layout/types.js';
import type { RawDocument } from '../parser/raw-model.js';
import type { SemanticDocument } from '../semantic/types.js';
import type { TableDetectionResult } from '../table/types.js';
import { createDefaultGraphicsStrategies } from './algorithms/defaults.js';
import type { GraphicsEngineInput, GraphicsStrategies } from './algorithms/types.js';
import type {
  GraphicChart,
  GraphicImage,
  GraphicObject,
  GraphicVector,
  GraphicsModel,
  GraphicsReconstructionResult,
} from './types.js';

export interface GraphicsReconstructionEngineOptions {
  strategies?: Partial<GraphicsStrategies>;
}

/**
 * Phase 8 — Graphics, Images & Drawing Reconstruction Engine.
 * Format-independent GraphicsModel. No export. No rasterization unless needed
 * (we never rasterize — vectors stay as vectors).
 */
export class GraphicsReconstructionEngine {
  readonly name = 'GraphicsReconstructionEngine' as const;
  private readonly strategies: GraphicsStrategies;

  constructor(options: GraphicsReconstructionEngineOptions = {}) {
    const defaults = createDefaultGraphicsStrategies();
    this.strategies = { ...defaults, ...options.strategies };
  }

  async reconstruct(input: {
    semantic: SemanticDocument;
    layout?: LayoutDocument | null;
    raw: RawDocument;
    tables?: TableDetectionResult | null;
  }): Promise<GraphicsReconstructionResult> {
    return this.GenerateGraphicsModel(input);
  }

  DetectImages(input: GraphicsEngineInput): GraphicImage[] {
    return this.strategies.images.detect(input);
  }

  DetectVectors(input: GraphicsEngineInput): GraphicVector[] {
    return this.strategies.vectors.detect(input);
  }

  AnalyzeCharts(
    vectors: GraphicVector[],
    images: GraphicImage[],
    input: GraphicsEngineInput,
  ): GraphicChart[] {
    return this.strategies.charts.analyze(vectors, images, input);
  }

  GroupGraphics(objects: GraphicObject[], input: GraphicsEngineInput) {
    return this.strategies.grouper.group(objects, input);
  }

  GenerateGraphicsModel(input: {
    semantic: SemanticDocument;
    layout?: LayoutDocument | null;
    raw: RawDocument;
    tables?: TableDetectionResult | null;
  }): GraphicsReconstructionResult {
    const ctx: GraphicsEngineInput = {
      semantic: input.semantic,
      layout: input.layout ?? null,
      raw: input.raw,
      tables: input.tables ?? null,
    };

    const images = this.DetectImages(ctx);
    const vectors = this.DetectVectors(ctx);
    const charts = this.AnalyzeCharts(vectors, images, ctx);

    // Members of charts are still kept as vectors; chart is a higher-level node
    let objects: GraphicObject[] = [...images, ...vectors, ...charts];
    objects = this.strategies.wrapping.analyze(objects, ctx);
    objects = this.strategies.captions.link(objects, ctx);

    const groups = this.GroupGraphics(objects, ctx);
    objects = [...objects, ...groups];

    const chartMemberIds = new Set(charts.flatMap((c) => c.memberIds));
    const groupedChildIds = new Set(groups.flatMap((g) => g.childIds));

    const rootIds = objects
      .filter((o) => {
        if (o.parentId) return false;
        // Prefer chart over its member vectors at root
        if (o.kind === 'vector' && chartMemberIds.has(o.id)) return false;
        if (groupedChildIds.has(o.id) && o.kind !== 'group') return false;
        return true;
      })
      .sort((a, b) => a.pageIndex - b.pageIndex || a.zIndex - b.zIndex)
      .map((o) => o.id);

    const resources = buildResourceIndex(images);
    const quality = scoreQuality(images, vectors, charts, groups, objects);

    const graphics: GraphicsModel = {
      id: createId('graphics'),
      sourceDocumentId: input.raw.id,
      objects,
      rootIds,
      resources,
      quality,
    };

    return {
      id: createId('gresult'),
      graphics,
    };
  }
}

function buildResourceIndex(images: GraphicImage[]) {
  const map: Record<string, { resourceKey: string; refs: string[] }> = {};
  for (const img of images) {
    const existing = map[img.resourceKey];
    if (existing) existing.refs.push(img.id);
    else map[img.resourceKey] = { resourceKey: img.resourceKey, refs: [img.id] };
  }
  return { images: map, patterns: [] as string[], gradients: [] as string[] };
}

function scoreQuality(
  images: GraphicImage[],
  vectors: GraphicVector[],
  charts: GraphicChart[],
  groups: { confidence: number }[],
  objects: GraphicObject[],
) {
  const avg = (arr: number[]) =>
    arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0.5;
  const image = avg(images.map((i) => i.confidence));
  const vector = avg(vectors.map((v) => v.confidence));
  const chart = avg(charts.map((c) => c.confidence));
  const shape = avg(
    vectors.filter((v) => v.shape !== 'unknown' && v.shape !== 'path').map((v) => v.confidence),
  );
  const grouping = avg(groups.map((g) => g.confidence));
  const wrapping = avg(objects.map((o) => (o.wrap ? 0.75 : 0.4)));
  const overall =
    image * 0.25 + vector * 0.25 + chart * 0.15 + shape * 0.1 + grouping * 0.1 + wrapping * 0.15;
  return { image, vector, chart, shape, grouping, wrapping, overall };
}
