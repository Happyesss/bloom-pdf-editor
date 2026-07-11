/**
 * Flow-based draw layout — compute glyph positions for justified lines.
 *
 * Raw PDF TJ spacing produces uneven gaps on justified lines. This module
 * lays out glyphs from the flow model so inter-word space is distributed evenly.
 * Uses OpenType-shaped widths when font data is available.
 */

import type { FontData } from '../fonts/font-parser';
import type { GlyphPosition, TextRun } from '../content/interpreter';
import type { TextLine } from './types';
import { getRunBounds } from './metrics';
import { measureText } from './shaping';
import { shouldUseFlowDraw } from './justification-detect';

export interface FlowGlyphDraw {
  glyph: GlyphPosition;
  run: TextRun;
  x: number;
  f: number;
}

interface IndexedGlyph {
  glyph: GlyphPosition;
  run: TextRun;
  charIndex: number;
}

function collectLineGlyphs(line: TextLine): IndexedGlyph[] {
  const glyphs: IndexedGlyph[] = [];
  let charOffset = 0;

  for (let r = 0; r < line.runs.length; r++) {
    const run = line.runs[r];
    for (let g = 0; g < run.glyphs.length; g++) {
      glyphs.push({ glyph: run.glyphs[g], run, charIndex: charOffset + g });
    }
    charOffset += run.text.length;
  }

  return glyphs;
}

function naturalPositions(line: TextLine): FlowGlyphDraw[] {
  const glyphs = collectLineGlyphs(line);
  return glyphs.map(g => ({
    glyph: g.glyph,
    run: g.run,
    x: g.glyph.tRm.e,
    f: g.glyph.tRm.f,
  }));
}

const STANDALONE_PUNCT = /^[,.:;!?\-\u2013\u2014\u201c\u201d'"\)\]\u00bb]+$/;

/** Split line text into words with character index ranges.
 *  Standalone punctuation tokens are merged with the preceding word. */
function splitWords(text: string): Array<{ start: number; end: number }> {
  const raw: Array<{ start: number; end: number }> = [];
  let i = 0;

  while (i < text.length) {
    while (i < text.length && text[i] === ' ') i++;
    if (i >= text.length) break;
    const start = i;
    while (i < text.length && text[i] !== ' ') i++;
    raw.push({ start, end: i });
  }

  // Merge standalone punctuation with the preceding word
  const merged: Array<{ start: number; end: number }> = [];
  for (let w = 0; w < raw.length; w++) {
    const token = text.substring(raw[w].start, raw[w].end);
    if (STANDALONE_PUNCT.test(token) && merged.length > 0) {
      // Extend previous word to include this punctuation
      merged[merged.length - 1].end = raw[w].end;
    } else {
      merged.push({ start: raw[w].start, end: raw[w].end });
    }
  }

  return merged;
}

function glyphsForRange(glyphs: IndexedGlyph[], start: number, end: number): IndexedGlyph[] {
  return glyphs.filter(g => g.charIndex >= start && g.charIndex < end);
}

function wordWidth(
  wordGlyphs: IndexedGlyph[],
  wordText: string,
  line: TextLine,
  fonts?: Map<string, FontData>,
): number {
  // Prefer native glyph span from the PDF — preserves kerning and exact positioning
  if (wordGlyphs.length > 0) {
    const first = wordGlyphs[0].glyph;
    const last = wordGlyphs[wordGlyphs.length - 1].glyph;
    const nativeSpan = (last.tRm.e + last.width) - first.tRm.e;
    if (nativeSpan > 0) return nativeSpan;
  }

  if (fonts && wordGlyphs.length > 0) {
    const run = wordGlyphs[0].run;
    const fontData = fonts.get(run.fontName);
    if (fontData) {
      return measureText(wordText, fontData, run.fontSize || line.fontSize);
    }
  }

  let w = 0;
  for (let i = 0; i < wordGlyphs.length; i++) {
    w += wordGlyphs[i].glyph.width;
  }
  return w;
}

/**
 * Lay out a justified line with even inter-word spacing.
 * Words may span multiple styled runs (bold/regular); gaps are uniform.
 */
export function computeFlowDrawPositions(
  line: TextLine,
  fonts?: Map<string, FontData>,
): FlowGlyphDraw[] {
  if (!shouldUseFlowDraw(line) || line.runs.length === 0) {
    return naturalPositions(line);
  }

  const allGlyphs = collectLineGlyphs(line);
  if (allGlyphs.length === 0) return [];

  const words = splitWords(line.text);
  if (words.length <= 1) {
    return naturalPositions(line);
  }

  const targetWidth = Math.max(
    line.width,
    line.rightEdge - line.leftMargin,
    getRunBounds(line.runs[line.runs.length - 1]).right - line.leftMargin,
  );

  const wordGlyphsList = words.map(w => glyphsForRange(allGlyphs, w.start, w.end));
  const wordTexts = words.map(w => line.text.substring(w.start, w.end));
  const wordWidths = wordGlyphsList.map((wg, wi) => wordWidth(wg, wordTexts[wi], line, fonts));
  const totalWordWidth = wordWidths.reduce((s, w) => s + w, 0);
  const numGaps = words.length - 1;

  if (numGaps <= 0 || targetWidth <= totalWordWidth) {
    return naturalPositions(line);
  }

  const evenGap = (targetWidth - totalWordWidth) / numGaps;
  const normalSpace = Math.max(line.fontSize * 0.25, 2);
  if (evenGap > normalSpace * 2) {
    return naturalPositions(line);
  }

  const baseline = line.baseline;
  const result: FlowGlyphDraw[] = [];
  let x = line.leftMargin;

  for (let wi = 0; wi < words.length; wi++) {
    const wg = wordGlyphsList[wi];
    if (wg.length > 0) {
      // Preserve native relative glyph positions within each word
      const wordStartNative = wg[0].glyph.tRm.e;
      for (let gi = 0; gi < wg.length; gi++) {
        const g = wg[gi];
        const nativeOffset = g.glyph.tRm.e - wordStartNative;
        result.push({
          glyph: g.glyph,
          run: g.run,
          x: x + nativeOffset,
          f: g.glyph.tRm.f ?? baseline,
        });
      }
      // Advance x past the word using its native span
      const lastG = wg[wg.length - 1];
      x += (lastG.glyph.tRm.e + lastG.glyph.width) - wordStartNative;
    }
    if (wi < words.length - 1) {
      x += evenGap;
    }
  }

  return result;
}

/** Map each run on a line to its flow-drawn glyphs. */
export function buildLineDrawMap(
  line: TextLine,
  fonts?: Map<string, FontData>,
): Map<TextRun, FlowGlyphDraw[]> {
  const positions = computeFlowDrawPositions(line, fonts);
  const map = new Map<TextRun, FlowGlyphDraw[]>();

  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const list = map.get(pos.run) ?? [];
    list.push(pos);
    map.set(pos.run, list);
  }

  return map;
}

/** Build lookup: run → line, and which lines use flow drawing. */
export function buildFlowDrawIndex(
  lines: TextLine[],
  fonts?: Map<string, FontData>,
): {
  runToLine: Map<TextRun, TextLine>;
  justifiedLines: Set<TextLine>;
  drawMaps: Map<TextLine, Map<TextRun, FlowGlyphDraw[]>>;
} {
  const runToLine = new Map<TextRun, TextLine>();
  const justifiedLines = new Set<TextLine>();
  const drawMaps = new Map<TextLine, Map<TextRun, FlowGlyphDraw[]>>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (let r = 0; r < line.runs.length; r++) {
      runToLine.set(line.runs[r], line);
    }
    if (shouldUseFlowDraw(line)) {
      justifiedLines.add(line);
      drawMaps.set(line, buildLineDrawMap(line, fonts));
    }
  }

  return { runToLine, justifiedLines, drawMaps };
}
