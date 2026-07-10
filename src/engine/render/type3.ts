/**
 * Type3 font glyph rendering — interpret CharProcs content streams as glyph outlines.
 */

import type { FontData } from '../fonts/font-parser';
import { parseContentStream } from '../content/operator-lexer';
import { PDFNumber } from '../types';

/**
 * Draw a Type3 glyph into the current canvas context.
 * CharProcs are miniature content streams in glyph space (FontMatrix).
 */
export function drawType3Glyph(
  ctx: CanvasRenderingContext2D,
  fontData: FontData,
  charName: string,
  x: number,
  y: number,
  fontSize: number,
): boolean {
  const stream = fontData.charProcs?.get(charName);
  if (!stream) return false;

  const bytes = stream.getBytes();
  if (!bytes || bytes.length === 0) return false;

  let instructions;
  try {
    instructions = parseContentStream(bytes);
  } catch {
    return false;
  }

  const matrix = fontData.fontMatrix ?? [0.001, 0, 0, 0.001, 0, 0];
  ctx.save();
  ctx.translate(x, y);
  ctx.transform(
    matrix[0] * fontSize,
    matrix[1] * fontSize,
    matrix[2] * fontSize,
    matrix[3] * fontSize,
    matrix[4] * fontSize,
    matrix[5] * fontSize,
  );

  ctx.beginPath();
  let cx = 0;
  let cy = 0;

  for (const inst of instructions) {
    const ops = inst.operands;
    const n = (i: number) => {
      const o = ops[i];
      return o instanceof PDFNumber ? o.value : 0;
    };

    switch (inst.operator) {
      case 'm':
        cx = n(0); cy = n(1);
        ctx.moveTo(cx, cy);
        break;
      case 'l':
        cx = n(0); cy = n(1);
        ctx.lineTo(cx, cy);
        break;
      case 'c':
        ctx.bezierCurveTo(n(0), n(1), n(2), n(3), n(4), n(5));
        cx = n(4); cy = n(5);
        break;
      case 'v':
        ctx.bezierCurveTo(cx, cy, n(0), n(1), n(2), n(3));
        cx = n(2); cy = n(3);
        break;
      case 'y':
        ctx.bezierCurveTo(n(0), n(1), n(2), n(3), n(2), n(3));
        cx = n(2); cy = n(3);
        break;
      case 'h':
        ctx.closePath();
        break;
      case 're':
        ctx.rect(n(0), n(1), n(2), n(3));
        break;
      case 'f':
      case 'F':
      case 'f*':
        ctx.fill();
        ctx.beginPath();
        break;
      case 'S':
        ctx.stroke();
        ctx.beginPath();
        break;
      case 'B':
      case 'B*':
        ctx.fill();
        ctx.stroke();
        ctx.beginPath();
        break;
      case 'd0':
      case 'd1':
        break;
      default:
        break;
    }
  }

  ctx.restore();
  return true;
}

/** Resolve a character code to a Type3 CharProcs name. */
export function type3CharName(fontData: FontData, charCode: number): string | null {
  if (!fontData.charProcs || fontData.charProcs.size === 0) return null;
  const candidates = [`g${charCode}`, `C${charCode}`, String(charCode)];
  for (const c of candidates) {
    if (fontData.charProcs.has(c)) return c;
  }
  const first = fontData.charProcs.keys().next();
  return first.done ? null : first.value;
}
