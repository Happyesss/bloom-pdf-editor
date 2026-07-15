import { createId } from '../../utils/id.js';
import type { PathCommand, RawVector } from '../parser/raw-model.js';
import type { GraphicsEngineInput, IVectorDetector } from './algorithms/types.js';
import type { GraphicVector, VectorShapeKind } from './types.js';

/**
 * Classify vector paths into reusable shape kinds. Prefer editable shapes
 * over flat rasterization.
 */
export class VectorDetector implements IVectorDetector {
  readonly name = 'VectorDetector';

  detect(input: GraphicsEngineInput): GraphicVector[] {
    const out: GraphicVector[] = [];
    for (const page of input.raw.pages) {
      for (const v of page.vectors) {
        // Skip vectors that are clearly table grid lines (consumed by Phase 7)
        if (looksLikeTableGrid(v, input)) continue;

        const shape = classifyShape(v.pathCommands, v.paint);
        out.push({
          id: createId('gvec'),
          kind: 'vector',
          pageIndex: page.index,
          bbox: { ...v.bbox },
          transform: v.transform,
          rotation: 0,
          opacity: v.opacity,
          layer: v.layer,
          zIndex: v.zIndex,
          parentId: null,
          childIds: [],
          wrap: 'in_front',
          sourceIds: [v.id],
          confidence: shape === 'unknown' ? 0.55 : 0.85,
          shape,
          style: {
            strokeWidth: v.strokeWidth,
            strokeColor: v.strokeColor,
            fillColor: v.fillColor,
            opacity: v.opacity,
            dashPattern: v.dashPattern,
            joinStyle: v.joinStyle,
            capStyle: v.capStyle,
          },
          pathCommandCount: v.pathCommands.length,
          closed: isClosed(v.pathCommands) || v.paint === 'fill' || v.paint === 'fillStroke',
        });
      }
    }
    return out;
  }
}

export function classifyShape(
  commands: PathCommand[],
  paint: RawVector['paint'],
): VectorShapeKind {
  if (paint === 'clip') return 'clipping_path';
  if (commands.length === 0) return 'unknown';

  const ops = commands.map((c) => c.op);
  const reCount = ops.filter((o) => o === 're').length;
  const lineCount = ops.filter((o) => o === 'l').length;
  const curveCount = ops.filter((o) => o === 'c' || o === 'v' || o === 'y').length;
  const moveCount = ops.filter((o) => o === 'm').length;

  if (reCount === 1 && commands.length <= 2) return 'rectangle';
  if (reCount > 1) return 'compound_path';

  if (moveCount === 1 && lineCount === 1 && curveCount === 0 && commands.length <= 3) {
    return 'line';
  }

  if (curveCount >= 4 && lineCount === 0 && looksLikeEllipse(commands)) {
    return 'ellipse';
  }

  if (curveCount > 0 && lineCount === 0) return 'bezier';
  if (lineCount >= 3 && curveCount === 0 && isClosed(commands)) return 'polygon';
  if (curveCount > 0 && lineCount > 0) return 'path';
  if (lineCount > 0) return 'path';
  return 'unknown';
}

function looksLikeEllipse(commands: PathCommand[]): boolean {
  // Four cubic arcs approximating a circle/ellipse is common in PDF drawings
  const curves = commands.filter((c) => c.op === 'c');
  return curves.length >= 4 && curves.length <= 8;
}

function isClosed(commands: PathCommand[]): boolean {
  if (commands.some((c) => c.op === 'h' || c.op === 're')) return true;
  const moves = commands.filter((c) => c.op === 'm') as Array<{ op: 'm'; x: number; y: number }>;
  const lines = commands.filter((c) => c.op === 'l') as Array<{ op: 'l'; x: number; y: number }>;
  if (moves.length === 0 || lines.length === 0) return false;
  const start = moves[0]!;
  const end = lines[lines.length - 1]!;
  return Math.abs(start.x - end.x) < 1 && Math.abs(start.y - end.y) < 1;
}

function looksLikeTableGrid(v: RawVector, input: GraphicsEngineInput): boolean {
  if (!input.tables?.tables.length) return false;
  for (const t of input.tables.tables) {
    if (t.pageIndex !== v.pageIndex) continue;
    if (t.kind !== 'bordered' && t.kind !== 'mixed') continue;
    const b = t.bbox;
    const vb = v.bbox;
    const inside =
      vb.x >= b.x - 2 &&
      vb.y >= b.y - 2 &&
      vb.x + vb.width <= b.x + b.width + 2 &&
      vb.y + vb.height <= b.y + b.height + 2;
    if (!inside) continue;
    // Pure stroke rectangles / lines inside bordered tables → table grid
    const onlyGridOps = v.pathCommands.every(
      (c) => c.op === 're' || c.op === 'm' || c.op === 'l' || c.op === 'h',
    );
    if (onlyGridOps && !v.fillColor) return true;
  }
  return false;
}
