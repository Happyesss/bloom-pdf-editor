/**
 * Text metrics — baselines, bounds, advances, and width estimation.
 *
 * Maths used:
 *   - Affine transforms: glyph position = T_rm = T_font × Tm × CTM
 *   - Baseline clustering: |y₁ − y₂| < ε where ε = max(2, 0.35 × fontSize)
 *   - Advance width: Σ (wᵢ/1000 × fontSize) + charSpacing + wordSpacing
 */

import type { TextRun } from '../content/interpreter';

export interface RunBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Median glyph baseline (PDF y coordinate). */
export function computeBaseline(run: TextRun): number {
  if (run.glyphs.length === 0) return run.y;
  const ys = run.glyphs.map(g => g.tRm.f);
  ys.sort((a, b) => a - b);
  return ys[Math.floor(ys.length / 2)];
}

export function getRunBounds(run: TextRun): RunBounds {
  if (run.glyphs.length === 0) {
    const h = run.height || run.fontSize || 12;
    return {
      x: run.x,
      y: run.y,
      width: run.width,
      height: h,
      left: run.x,
      right: run.x + run.width,
      top: run.y + h,
      bottom: run.y,
    };
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  const fontSize = run.glyphs[0].fontSize || run.fontSize || 12;

  for (let g = 0; g < run.glyphs.length; g++) {
    const glyph = run.glyphs[g];
    const gx = glyph.tRm.e;
    const gy = glyph.tRm.f;
    if (gx < minX) minX = gx;
    if (gx + glyph.width > maxX) maxX = gx + glyph.width;
    if (gy < minY) minY = gy;
    if (gy > maxY) maxY = gy;
  }

  return {
    x: minX,
    y: minY - fontSize * 0.2,
    width: maxX - minX,
    height: (maxY - minY) + fontSize * 1.1,
    left: minX,
    right: maxX,
    top: maxY + fontSize * 0.85,
    bottom: minY - fontSize * 0.25,
  };
}

/** Average character width for a run (page units). */
export function averageCharWidth(run: TextRun): number {
  if (run.text.length === 0) return (run.fontSize || 12) * 0.5;
  const bounds = getRunBounds(run);
  return bounds.width / run.text.length;
}

/** Gap between two horizontally adjacent runs on the same line. */
export function gapBetweenRuns(left: TextRun, right: TextRun): number {
  const l = getRunBounds(left);
  const r = getRunBounds(right);
  return r.left - l.right;
}

/** Estimate rendered width of a string using run metrics. */
export function estimateTextWidth(text: string, run: TextRun): number {
  if (text.length === 0) return 0;
  const avg = averageCharWidth(run);
  return text.length * avg;
}
