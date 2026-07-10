/**
 * Selection → PDF QuadPoints for text markup annotations.
 */

import type { TextLine } from './types';
import { lineXFromCaretIndex } from './hit-test';

/**
 * Build QuadPoints for a character range on a single line.
 * Returns [] for empty selection.
 * Order: top-left, top-right, bottom-left, bottom-right (PDF y-up).
 */
export function lineSelectionToQuadPoints(
  line: TextLine,
  start: number,
  end: number,
): number[] {
  const a = Math.max(0, Math.min(start, line.text.length));
  const b = Math.max(a, Math.min(end, line.text.length));
  if (a === b) return [];

  const x1 = lineXFromCaretIndex(line, a);
  const x2 = lineXFromCaretIndex(line, b);
  const left = Math.min(x1, x2);
  const right = Math.max(x1, x2);
  const h = Math.max(line.height, line.fontSize);
  const top = line.baseline + h;
  const bottom = line.baseline;

  return [
    left, top,
    right, top,
    left, bottom,
    right, bottom,
  ];
}

/** Union bounding rect from quad points. */
export function quadPointsToRect(quadPoints: number[]): {
  x: number; y: number; width: number; height: number;
} {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i + 1 < quadPoints.length; i += 2) {
    xs.push(quadPoints[i]);
    ys.push(quadPoints[i + 1]);
  }
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * Multi-line selection: full lines between first/last, partial on ends.
 */
export function multiLineSelectionToQuadPoints(
  lines: TextLine[],
  startLineIndex: number,
  startChar: number,
  endLineIndex: number,
  endChar: number,
): number[] {
  if (lines.length === 0) return [];
  let sLi = Math.max(0, Math.min(startLineIndex, lines.length - 1));
  let eLi = Math.max(0, Math.min(endLineIndex, lines.length - 1));
  let sCh = startChar;
  let eCh = endChar;
  if (sLi > eLi || (sLi === eLi && sCh > eCh)) {
    [sLi, eLi] = [eLi, sLi];
    [sCh, eCh] = [eCh, sCh];
  }

  const quads: number[] = [];
  for (let i = sLi; i <= eLi; i++) {
    const line = lines[i];
    const from = i === sLi ? sCh : 0;
    const to = i === eLi ? eCh : line.text.length;
    quads.push(...lineSelectionToQuadPoints(line, from, to));
  }
  return quads;
}

export { caretIndexFromLineX } from './hit-test';

// Re-export highlight helper (tests import from this module)
export { addHighlightFromSelection } from '../editor/highlight';
export type { SelectionPos } from '../editor/highlight';
