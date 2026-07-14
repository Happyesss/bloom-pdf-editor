import * as Engine from '../index';
import type { ExtractedPageData } from './glyph-extraction';
import type { TextRun } from './types';
import { mapPdfFontToWord, rgbToHex } from './glyph-extraction';

export interface ExportLine {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  baseline: number;
  runs: TextRun[];
  rawLine: Engine.TextLine;
}

export function groupIntoLines(data: ExtractedPageData): ExportLine[] {
  const flow = Engine.buildDocumentFlow(data.rawTextRuns);
  
  const lines: ExportLine[] = [];
  for (const line of flow.lines) {
    const runs = spansFromLine(line, data.fonts);
    if (runs.length > 0) {
      lines.push({
        id: line.id,
        x: line.x,
        y: line.y,
        width: line.width,
        height: line.height,
        baseline: line.baseline,
        runs,
        rawLine: line
      });
    }
  }

  // Phase 4: Reading Order & Multi-Column Support
  // Sort lines top-to-bottom.
  // For now, sorting by Y primarily, X secondarily.
  lines.sort((a, b) => {
    const dy = b.y - a.y; // Top-to-bottom (PDF Y is up)
    if (Math.abs(dy) > 4) return dy;
    return a.x - b.x;
  });

  return lines;
}

function spansFromLine(line: Engine.TextLine, fonts: Map<string, Engine.FontData>): TextRun[] {
  const spans: TextRun[] = [];
  for (const run of line.runs) {
    const fontData = fonts.get(run.fontName) ?? null;
    const flags = Engine.resolveRunStyleFlags(run.fontName, fontData);
    const color = rgbToHex(run.fillColor);
    const text = sanitizeText(run.text);
    if (!text) continue;
    spans.push({
      text,
      fontFamily: mapPdfFontToWord(run.fontName, fontData),
      fontSize: run.fontSize || run.glyphs[0]?.fontSize || 11,
      bold: flags.bold,
      italic: flags.italic,
      color,
    });
  }

  // merge adjacent identical spans
  const merged: TextRun[] = [];
  for (const s of spans) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.fontFamily === s.fontFamily &&
      Math.abs(prev.fontSize - s.fontSize) < 0.5 &&
      prev.bold === s.bold &&
      prev.italic === s.italic &&
      prev.color === s.color
    ) {
      prev.text += s.text;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

export function sanitizeText(text: string): string {
  return [...text]
    .map(ch => {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x09) return '';
      if (code === 0x09 || code === 0x0a || code === 0x0d) return ' ';
      if (code < 0x20) return '';
      if (code === 0xfffd || code === 0xfffc) return '';
      return ch;
    })
    .join('');
}
