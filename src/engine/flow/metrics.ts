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

/**
 * Visual font size in page units (what the canvas draws).
 * Prefers glyph text-rendering matrix over raw Tf — resumes often use
 * `1 Tf` + scaled Tm, so Tf alone under-reports size.
 */
export function visualFontSize(run: TextRun): number {
  if (run.glyphs.length > 0) {
    const tRm = run.glyphs[0].tRm;
    const fromTrm = Math.sqrt(tRm.c * tRm.c + tRm.d * tRm.d);
    if (fromTrm > 0.5) return fromTrm;
    if (run.glyphs[0].fontSize > 0.5) return run.glyphs[0].fontSize;
  }
  return run.fontSize > 0.5 ? run.fontSize : 12;
}

/** Infer bold/italic from a PDF font resource / BaseFont name. */
export function fontNameStyleFlags(fontName: string): { bold: boolean; italic: boolean } {
  const lower = fontName.replace(/^.*\+/, '').toLowerCase();
  return {
    bold: /bold|black|heavy|extrabold|demibold|semibold/.test(lower),
    italic: /italic|oblique|slanted/.test(lower),
  };
}

/** Resolve style flags using FontData when the resource key alone is opaque (F1, etc.). */
export function resolveRunStyleFlags(
  fontName: string,
  fontData?: { baseFont?: string; standardMetrics?: { isBold: boolean; isItalic: boolean } | null } | null,
): { bold: boolean; italic: boolean } {
  if (fontData?.standardMetrics) {
    return {
      bold: fontData.standardMetrics.isBold,
      italic: fontData.standardMetrics.isItalic,
    };
  }
  if (fontData?.baseFont) return fontNameStyleFlags(fontData.baseFont);
  return fontNameStyleFlags(fontName);
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
  // Use visual size for padding so selection/edit boxes match on-canvas text
  const fontSize = visualFontSize(run);

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
