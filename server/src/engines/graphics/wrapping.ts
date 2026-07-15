import type { BoundingBox } from '../common/geometry.js';
import type { GraphicsEngineInput, IWrappingAnalyzer } from './algorithms/types.js';
import type { GraphicObject, WrapMode } from './types.js';

/**
 * Infer text wrapping / float modes from geometry vs surrounding text blocks.
 */
export class WrappingAnalyzer implements IWrappingAnalyzer {
  readonly name = 'WrappingAnalyzer';

  analyze(objects: GraphicObject[], input: GraphicsEngineInput): GraphicObject[] {
    const textBoxes = collectTextBoxes(input);

    for (const obj of objects) {
      if (obj.kind === 'group') continue;
      const pageText = textBoxes.filter((t) => t.pageIndex === obj.pageIndex);
      obj.wrap = inferWrap(obj, pageText);
    }
    return objects;
  }
}

function collectTextBoxes(
  input: GraphicsEngineInput,
): Array<{ pageIndex: number; bbox: BoundingBox }> {
  const out: Array<{ pageIndex: number; bbox: BoundingBox }> = [];
  for (const n of Object.values(input.semantic.nodes)) {
    if (!n.bbox) continue;
    if (
      n.type === 'paragraph' ||
      n.type === 'heading' ||
      n.type === 'list_item' ||
      n.type === 'caption'
    ) {
      out.push({ pageIndex: n.pageIndex, bbox: n.bbox });
    }
  }
  return out;
}

function inferWrap(
  obj: GraphicObject,
  texts: Array<{ pageIndex: number; bbox: BoundingBox }>,
): WrapMode {
  if (obj.kind === 'vector' && obj.opacity < 0.4) return 'behind';

  const overlapping = texts.filter((t) => intersects(obj.bbox, t.bbox));
  if (overlapping.length === 0) {
    // Isolated graphic — floating or square depending on size
    const area = obj.bbox.width * obj.bbox.height;
    return area > 40_000 ? 'square' : 'floating';
  }

  // Text overlaps bbox significantly → behind or in front by z
  const textOverlapRatio = overlapping.reduce((s, t) => s + overlapArea(obj.bbox, t.bbox), 0) /
    Math.max(obj.bbox.width * obj.bbox.height, 1);
  if (textOverlapRatio > 0.35) {
    return obj.zIndex >= 50 ? 'in_front' : 'behind';
  }

  // Text beside image → square; text above/below tight band → inline/anchored
  const beside = overlapping.some((t) => horizontalNeighbor(obj.bbox, t.bbox));
  if (beside) return 'square';

  const belowOrAbove = overlapping.some((t) => verticalNeighbor(obj.bbox, t.bbox));
  if (belowOrAbove && obj.kind === 'image') return 'inline';

  return 'anchored';
}

function intersects(a: BoundingBox, b: BoundingBox): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

function overlapArea(a: BoundingBox, b: BoundingBox): number {
  const x0 = Math.max(a.x, b.x);
  const y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.width, b.x + b.width);
  const y1 = Math.min(a.y + a.height, b.y + b.height);
  if (x1 <= x0 || y1 <= y0) return 0;
  return (x1 - x0) * (y1 - y0);
}

function horizontalNeighbor(a: BoundingBox, b: BoundingBox): boolean {
  const vertOverlap =
    Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y) > Math.min(a.height, b.height) * 0.3;
  const gap = a.x < b.x ? b.x - (a.x + a.width) : a.x - (b.x + b.width);
  return vertOverlap && gap >= 0 && gap < 40;
}

function verticalNeighbor(a: BoundingBox, b: BoundingBox): boolean {
  const horizOverlap =
    Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x) > Math.min(a.width, b.width) * 0.3;
  const gap = a.y < b.y ? b.y - (a.y + a.height) : a.y - (b.y + b.height);
  return horizOverlap && gap >= 0 && gap < 36;
}
