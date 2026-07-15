import { createId } from '../../utils/id.js';
import type { BoundingBox } from '../common/geometry.js';
import type {
  GraphicsEngineInput,
  IChartAnalyzer,
} from './algorithms/types.js';
import type { ChartKind, GraphicChart, GraphicImage, GraphicVector } from './types.js';

/**
 * Heuristic chart candidates from clustered vectors / chart-like images.
 * Marks editable candidates; does not synthesize chart data series.
 */
export class ChartAnalyzer implements IChartAnalyzer {
  readonly name = 'ChartAnalyzer';

  analyze(
    vectors: GraphicVector[],
    images: GraphicImage[],
    input: GraphicsEngineInput,
  ): GraphicChart[] {
    const out: GraphicChart[] = [];
    const byPage = new Map<number, GraphicVector[]>();
    for (const v of vectors) {
      let arr = byPage.get(v.pageIndex);
      if (!arr) {
        arr = [];
        byPage.set(v.pageIndex, arr);
      }
      arr.push(v);
    }

    for (const [pageIndex, pageVecs] of byPage) {
      const bars = detectBarChart(pageVecs, pageIndex);
      if (bars) out.push(bars);

      const pie = detectPieChart(pageVecs, pageIndex);
      if (pie) out.push(pie);

      const line = detectLineChart(pageVecs, pageIndex);
      if (line) out.push(line);
    }

    // Images near "Figure/Chart" captions → chart-like image candidates
    for (const img of images) {
      if (hasChartCaptionNearby(img, input)) {
        out.push({
          id: createId('gchart'),
          kind: 'chart',
          pageIndex: img.pageIndex,
          bbox: { ...img.bbox },
          rotation: img.rotation,
          opacity: img.opacity,
          zIndex: img.zIndex,
          parentId: null,
          childIds: [],
          wrap: img.wrap,
          sourceIds: [...img.sourceIds],
          confidence: 0.55,
          chartKind: 'unknown',
          seriesCount: 0,
          editableCandidate: false,
          memberIds: [img.id],
        });
      }
    }

    return out;
  }
}

function detectBarChart(vectors: GraphicVector[], pageIndex: number): GraphicChart | null {
  const rects = vectors.filter((v) => v.shape === 'rectangle' || v.shape === 'rounded_rectangle');
  if (rects.length < 3) return null;

  // Similar baseline (bottoms aligned) and varying heights → bar chart
  const bottoms = rects.map((r) => r.bbox.y);
  const bottomMed = median(bottoms);
  const aligned = rects.filter((r) => Math.abs(r.bbox.y - bottomMed) < 8);
  if (aligned.length < 3) return null;

  const heights = aligned.map((r) => r.bbox.height);
  const uniqueH = new Set(heights.map((h) => Math.round(h / 4)));
  if (uniqueH.size < 2) return null;

  return makeChart('bar', aligned, pageIndex, 0.75, true);
}

function detectPieChart(vectors: GraphicVector[], pageIndex: number): GraphicChart | null {
  const arcs = vectors.filter(
    (v) =>
      (v.shape === 'ellipse' || v.shape === 'bezier' || v.shape === 'path') &&
      v.closed &&
      aspectNearSquare(v.bbox),
  );
  if (arcs.length < 2) return null;
  // Overlapping near-square closed paths → pie wedges
  const cluster = clusterOverlapping(arcs);
  if (cluster.length < 2) return null;
  return makeChart('pie', cluster, pageIndex, 0.65, true);
}

function detectLineChart(vectors: GraphicVector[], pageIndex: number): GraphicChart | null {
  const polylines = vectors.filter(
    (v) =>
      (v.shape === 'path' || v.shape === 'line' || v.shape === 'bezier') &&
      v.pathCommandCount >= 3 &&
      !v.closed,
  );
  if (polylines.length < 1) return null;

  // Axis-like long H + V lines nearby boost confidence
  const axes = vectors.filter((v) => v.shape === 'line');
  const hasAxes = axes.length >= 2;
  if (!hasAxes && polylines.length < 2) return null;

  return makeChart('line', [...polylines, ...axes.slice(0, 4)], pageIndex, hasAxes ? 0.7 : 0.55, true);
}

function makeChart(
  chartKind: ChartKind,
  members: GraphicVector[],
  pageIndex: number,
  confidence: number,
  editable: boolean,
): GraphicChart {
  const bbox = unionBBoxes(members.map((m) => m.bbox));
  return {
    id: createId('gchart'),
    kind: 'chart',
    pageIndex,
    bbox,
    rotation: 0,
    opacity: 1,
    zIndex: Math.max(...members.map((m) => m.zIndex)),
    parentId: null,
    childIds: [],
    wrap: 'square',
    sourceIds: members.flatMap((m) => m.sourceIds),
    confidence,
    chartKind,
    seriesCount: chartKind === 'bar' ? members.length : Math.max(1, members.length - 2),
    editableCandidate: editable,
    memberIds: members.map((m) => m.id),
  };
}

function hasChartCaptionNearby(img: GraphicImage, input: GraphicsEngineInput): boolean {
  for (const n of Object.values(input.semantic.nodes)) {
    if (n.type !== 'caption' || !n.bbox || n.pageIndex !== img.pageIndex) continue;
    const text = 'text' in n ? String(n.text ?? '') : '';
    if (!/\b(chart|graph|figure|plot)\b/i.test(text)) continue;
    const dy = Math.abs(n.bbox.y - (img.bbox.y + img.bbox.height));
    const dx = Math.abs(n.bbox.x - img.bbox.x);
    if (dy < 48 && dx < 80) return true;
  }
  return false;
}

function aspectNearSquare(b: BoundingBox): boolean {
  if (b.width < 20 || b.height < 20) return false;
  const r = b.width / b.height;
  return r > 0.7 && r < 1.4;
}

function clusterOverlapping(items: GraphicVector[]): GraphicVector[] {
  if (items.length === 0) return [];
  const seed = items[0]!;
  return items.filter((o) => intersects(expand(seed.bbox, 6), o.bbox));
}

function unionBBoxes(boxes: BoundingBox[]): BoundingBox {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function expand(b: BoundingBox, pad: number): BoundingBox {
  return { x: b.x - pad, y: b.y - pad, width: b.width + pad * 2, height: b.height + pad * 2 };
}

function intersects(a: BoundingBox, b: BoundingBox): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}
