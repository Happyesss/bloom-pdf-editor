import type { BoundingBox } from '../common/geometry.js';
import type { SemanticCaption } from '../semantic/types.js';
import type { GraphicsEngineInput, ICaptionLinker } from './algorithms/types.js';
import type { GraphicObject } from './types.js';

/**
 * Associate semantic captions with images, charts, and drawings.
 * Also sets SemanticCaption.targetId when possible.
 */
export class CaptionLinker implements ICaptionLinker {
  readonly name = 'CaptionLinker';

  link(objects: GraphicObject[], input: GraphicsEngineInput): GraphicObject[] {
    const captions = Object.values(input.semantic.nodes).filter(
      (n): n is SemanticCaption => n.type === 'caption' && !!n.bbox,
    );

    const targets = objects.filter(
      (o) => o.kind === 'image' || o.kind === 'chart' || o.kind === 'group',
    );

    for (const cap of captions) {
      let best: GraphicObject | null = null;
      let bestDist = Infinity;
      for (const t of targets) {
        if (t.pageIndex !== cap.pageIndex || !cap.bbox) continue;
        const d = captionDistance(cap.bbox, t.bbox);
        if (d < bestDist && d < 72) {
          bestDist = d;
          best = t;
        }
      }
      if (best) {
        best.captionId = cap.id;
        cap.targetId = best.id;
      }
    }

    return objects;
  }
}

function captionDistance(cap: BoundingBox, target: BoundingBox): number {
  const capMidX = cap.x + cap.width / 2;
  const targetMidX = target.x + target.width / 2;
  const dx = Math.abs(capMidX - targetMidX);
  // Prefer captions directly below the figure
  const belowGap = target.y - (cap.y + cap.height);
  const aboveGap = cap.y - (target.y + target.height);
  const dy =
    belowGap >= -4 && belowGap < 64
      ? belowGap
      : aboveGap >= -4 && aboveGap < 48
        ? aboveGap + 20
        : Math.abs(cap.y - target.y) + 40;
  return dx * 0.5 + dy;
}
