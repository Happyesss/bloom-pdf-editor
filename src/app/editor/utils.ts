import type { TextRun, ImageItem, PathItem } from '@/engine';

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
    if (run.glyphs.length === 0) continue;
    const first = run.glyphs[0];
    const last  = run.glyphs[run.glyphs.length - 1];
    const fontSize = first.fontSize || 12;
    const left   = Math.min(first.tRm.e, last.tRm.e) - 2;
    const right  = Math.max(first.tRm.e, last.tRm.e) + last.width + 2;
    const bottom = Math.min(first.tRm.f, last.tRm.f) - fontSize * 0.3;
    const top    = Math.max(first.tRm.f, last.tRm.f) + fontSize * 0.85;
    if (pdfX >= left && pdfX <= right && pdfY >= bottom && pdfY <= top) {
      return run;
    }
  }
  return null;
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
