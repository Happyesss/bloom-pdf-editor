import type { TextRun, ImageItem, PathItem, FontData, TextLine } from '@/engine';
import {
  hitTestTextLine,
  findNearestTextLine,
  caretIndexFromLineX,
  lineXFromCaretIndex,
  computeEditPreview,
  computeLineHeight,
} from '@/engine';

export { hitTestTextLine, findNearestTextLine, caretIndexFromLineX, lineXFromCaretIndex, computeEditPreview, computeLineHeight };

/** Bounds for a logical text line. */
export function getLineBounds(line: TextLine): { x: number; y: number; width: number; height: number } {
  return { x: line.x, y: line.y, width: line.width, height: line.height };
}

/** Compute bounding box for a text run in PDF coordinates. */
export function getRunBounds(run: TextRun): { x: number; y: number; width: number; height: number } {
  if (run.glyphs.length > 0) {
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    const fontSize = run.glyphs[0].fontSize || run.fontSize || 12;
    for (let g = 0; g < run.glyphs.length; g++) {
      const glyph = run.glyphs[g];
      if (glyph.tRm.e < minX) minX = glyph.tRm.e;
      if (glyph.tRm.e + glyph.width > maxX) maxX = glyph.tRm.e + glyph.width;
      if (glyph.tRm.f < minY) minY = glyph.tRm.f;
      if (glyph.tRm.f > maxY) maxY = glyph.tRm.f;
    }
    return {
      x: minX,
      y: minY - fontSize * 0.2,
      width: maxX - minX,
      height: (maxY - minY) + fontSize * 1.1,
    };
  }
  return { x: run.x, y: run.y, width: run.width, height: run.height || run.fontSize || 12 };
}

/** Build a CSS font string for overlay text preview. */
export function getOverlayFontFamily(fontName: string, fontData?: FontData): string {
  if (fontData?.fontBytes && fontData.baseFont) {
    const plus = fontData.baseFont.indexOf('+');
    const stripped = plus >= 0 ? fontData.baseFont.slice(plus + 1) : fontData.baseFont;
    return `"${stripped}", "${fontData.baseFont}", serif`;
  }
  const lower = (fontData?.baseFont || fontName).toLowerCase();
  if (lower.includes('courier') || lower.includes('mono')) return '"Courier New", monospace';
  if (lower.includes('times') || lower.includes('roman') || lower.includes('cmr')) {
    return '"Times New Roman", Times, serif';
  }
  if (lower.includes('helv') || lower.includes('arial')) return 'Helvetica, Arial, sans-serif';
  return '"Times New Roman", Times, serif';
}

/** Convert a canvas CSS‐pixel mouse position to PDF user‐space coordinates. */
export function canvasToPdf(
  cssX: number,
  cssY: number,
  scale: number,
  pageWidth: number,
  pageHeight: number,
  mediaBoxX: number,
  mediaBoxY: number,
): { pdfX: number; pdfY: number } {
  return {
    pdfX: cssX / scale + mediaBoxX,
    pdfY: (mediaBoxY + pageHeight) - cssY / scale,
  };
}

/** Convert PDF user‐space coordinates to canvas CSS pixels. */
export function pdfToCanvas(
  pdfX: number,
  pdfY: number,
  scale: number,
  pageHeight: number,
  mediaBoxX: number,
  mediaBoxY: number,
): { cssX: number; cssY: number } {
  return {
    cssX: (pdfX - mediaBoxX) * scale,
    cssY: ((mediaBoxY + pageHeight) - pdfY) * scale,
  };
}

/** Hit-test: find the TextRun under a given PDF coordinate. */
export function hitTestTextRuns(
  pdfX: number,
  pdfY: number,
  textRuns: TextRun[],
): TextRun | null {
  for (let i = textRuns.length - 1; i >= 0; i--) {
    const run = textRuns[i];

    // For runs with glyphs, compute bounds from glyph positions
    if (run.glyphs.length > 0) {
      const first = run.glyphs[0];
      const last  = run.glyphs[run.glyphs.length - 1];
      const fontSize = first.fontSize || 12;

      // Compute horizontal bounds from all glyphs (not just first/last)
      // This handles cases where glyphs aren't strictly left-to-right
      let minX = Infinity, maxX = -Infinity;
      let minY = Infinity, maxY = -Infinity;
      for (let g = 0; g < run.glyphs.length; g++) {
        const glyph = run.glyphs[g];
        const gx = glyph.tRm.e;
        const gy = glyph.tRm.f;
        if (gx < minX) minX = gx;
        if (gx + glyph.width > maxX) maxX = gx + glyph.width;
        if (gy < minY) minY = gy;
        if (gy > maxY) maxY = gy;
      }

      // Generous padding — crucial for headings, brackets, small text
      const hPad = Math.max(4, fontSize * 0.15);
      const left   = minX - hPad;
      const right  = maxX + hPad;
      // Ensure minimum width for narrow/single-char runs
      const minWidth = fontSize * 0.6;
      const width = right - left;
      const adjustedLeft = width < minWidth ? left - (minWidth - width) / 2 : left;
      const adjustedRight = width < minWidth ? right + (minWidth - width) / 2 : right;

      const bottom = minY - fontSize * 0.4;
      const top    = maxY + fontSize * 1.0;

      if (pdfX >= adjustedLeft && pdfX <= adjustedRight && pdfY >= bottom && pdfY <= top) {
        return run;
      }
    } else if (run.width > 0 && run.height > 0) {
      // Fallback for runs with no glyphs — use the run's own bounding box
      const pad = 4;
      if (
        pdfX >= run.x - pad && pdfX <= run.x + run.width + pad &&
        pdfY >= run.y - pad && pdfY <= run.y + run.height + pad
      ) {
        return run;
      }
    }
  }
  return null;
}

/**
 * Find the nearest TextRun to a PDF coordinate within a proximity threshold.
 * Used as fallback when direct hit testing fails — enables "click near text" editing.
 */
export function findNearestTextRun(
  pdfX: number,
  pdfY: number,
  textRuns: TextRun[],
  maxDistance: number = 15,
): TextRun | null {
  let bestRun: TextRun | null = null;
  let bestDist = maxDistance;

  for (let i = 0; i < textRuns.length; i++) {
    const run = textRuns[i];
    if (run.glyphs.length === 0 && run.width <= 0) continue;

    let runLeft: number, runRight: number, runBottom: number, runTop: number;

    if (run.glyphs.length > 0) {
      const fontSize = run.glyphs[0].fontSize || 12;
      runLeft = Infinity; runRight = -Infinity;
      runBottom = Infinity; runTop = -Infinity;
      for (let g = 0; g < run.glyphs.length; g++) {
        const glyph = run.glyphs[g];
        if (glyph.tRm.e < runLeft) runLeft = glyph.tRm.e;
        if (glyph.tRm.e + glyph.width > runRight) runRight = glyph.tRm.e + glyph.width;
        if (glyph.tRm.f < runBottom) runBottom = glyph.tRm.f;
        if (glyph.tRm.f > runTop) runTop = glyph.tRm.f;
      }
      runBottom -= fontSize * 0.3;
      runTop += fontSize * 0.85;
    } else {
      runLeft = run.x;
      runRight = run.x + run.width;
      runBottom = run.y;
      runTop = run.y + run.height;
    }

    // Distance from point to bounding box
    const dx = pdfX < runLeft ? runLeft - pdfX : pdfX > runRight ? pdfX - runRight : 0;
    const dy = pdfY < runBottom ? runBottom - pdfY : pdfY > runTop ? pdfY - runTop : 0;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < bestDist) {
      bestDist = dist;
      bestRun = run;
    }
  }

  return bestRun;
}

/** Hit-test: find an ImageItem or PathItem under a PDF coordinate. */
export function hitTestDisplayItems(
  pdfX: number,
  pdfY: number,
  items: (ImageItem | PathItem)[],
): ImageItem | PathItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.width <= 0 || item.height <= 0) continue;
    if (
      pdfX >= item.x && pdfX <= item.x + item.width &&
      pdfY >= item.y && pdfY <= item.y + item.height
    ) {
      return item;
    }
  }
  return null;
}

/**
 * Given a PDF X coordinate within a text run, find the character index
 * for caret placement (0 = before first char, glyphs.length = after last).
 */
export function caretIndexFromPdfX(pdfX: number, run: TextRun): number {
  const glyphs = run.glyphs;
  if (glyphs.length === 0) return 0;
  // Walk through each glyph and find the midpoint boundary
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const mid = g.tRm.e + g.width / 2;
    if (pdfX < mid) return i;
  }
  return glyphs.length;
}

/** Convert #RRGGBB to [r,g,b] where each is 0-1 */
export function hexToRGB(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return [
      parseInt(clean[0]+clean[0], 16) / 255,
      parseInt(clean[1]+clean[1], 16) / 255,
      parseInt(clean[2]+clean[2], 16) / 255,
    ];
  }
  return [
    parseInt(clean.substring(0,2), 16) / 255,
    parseInt(clean.substring(2,4), 16) / 255,
    parseInt(clean.substring(4,6), 16) / 255,
  ];
}
