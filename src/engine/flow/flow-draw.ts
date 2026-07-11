/**
 * Flow-based draw layout — evening unjustified TJ word rivers and packing
 * bold→punctuation artifacts.
 *
 * Rules:
 *   - Tab/column gaps are never clamped (contact separators, date columns)
 *   - Dashes are never treated as trailing punctuation
 *   - Body lines with uneven word gaps get even inter-word spacing
 *   - Only medium gaps immediately before `,.:;!?)` are packed away
 */

import type { FontData } from '../fonts/font-parser';
import type { GlyphPosition, TextRun } from '../content/interpreter';
import type { TextLine } from './types';
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

const KERN_FRAC = 0.12;
const PUNCT_PACK_MAX_FRAC = 1.5;
const BULLET_CHARS = /^[\u2022\u2023\u25E6\u2043\u2219\u00B7\u25CF\u25CB•∙]$/;
const TRAILING_PUNCT = /^[,.:;!?)]+$/;
const TRAILING_PUNCT_CHAR = /^[,.:;!?)]$/;

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
  return collectLineGlyphs(line).map(g => ({
    glyph: g.glyph,
    run: g.run,
    x: g.glyph.tRm.e,
    f: g.glyph.tRm.f,
  }));
}

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

  const merged: Array<{ start: number; end: number }> = [];
  for (let w = 0; w < raw.length; w++) {
    const token = text.substring(raw[w].start, raw[w].end);
    if (TRAILING_PUNCT.test(token) && merged.length > 0) {
      merged[merged.length - 1].end = raw[w].end;
    } else {
      merged.push({ start: raw[w].start, end: raw[w].end });
    }
  }
  return merged;
}

function glyphsForRange(glyphs: IndexedGlyph[], start: number, end: number): IndexedGlyph[] {
  return glyphs.filter(g =>
    g.charIndex >= start &&
    g.charIndex < end &&
    g.glyph.unicode !== ' ' &&
    g.glyph.unicode !== '\u00A0',
  );
}

function shouldSuppressGap(cur: GlyphPosition, nativeGap: number, fontSize: number): boolean {
  if (nativeGap <= 0) return false;
  if (!TRAILING_PUNCT_CHAR.test(cur.unicode)) return false;
  if (nativeGap < fontSize * KERN_FRAC) return false;
  return nativeGap < fontSize * PUNCT_PACK_MAX_FRAC;
}

function packWordGlyphs(
  wg: IndexedGlyph[],
  startX: number,
  baseline: number,
  result: FlowGlyphDraw[],
): number {
  let currentX = startX;
  for (let gi = 0; gi < wg.length; gi++) {
    const g = wg[gi];
    if (gi > 0) {
      const prev = wg[gi - 1].glyph;
      const nativeGap = g.glyph.tRm.e - (prev.tRm.e + prev.width);
      const fs = g.glyph.fontSize || prev.fontSize;
      if (shouldSuppressGap(g.glyph, nativeGap, fs)) {
        // drop bold→punct artifact only
      } else {
        // Never pull glyphs left — negative gaps from width errors collapse
        // "|" into "HTML" and icons into "Next.js".
        currentX += Math.max(0, nativeGap);
      }
    }
    result.push({
      glyph: g.glyph,
      run: g.run,
      x: currentX,
      f: g.glyph.tRm.f ?? baseline,
    });
    currentX += g.glyph.width;
  }
  return currentX;
}

function packedWordWidth(wg: IndexedGlyph[], line: TextLine): number {
  if (wg.length === 0) return 0;
  let w = 0;
  for (let i = 0; i < wg.length; i++) {
    if (i > 0) {
      const prev = wg[i - 1].glyph;
      const cur = wg[i].glyph;
      const gap = cur.tRm.e - (prev.tRm.e + prev.width);
      const fs = cur.fontSize || line.fontSize;
      if (!shouldSuppressGap(cur, gap, fs)) w += Math.max(0, gap);
    }
    w += wg[i].glyph.width;
  }
  return w;
}

function wordWidth(
  wg: IndexedGlyph[],
  wordText: string,
  line: TextLine,
  fonts?: Map<string, FontData>,
): number {
  const packed = packedWordWidth(wg, line);
  if (packed > 0) return packed;

  if (fonts && wg.length > 0) {
    const run = wg[0].run;
    const fontData = fonts.get(run.fontName);
    if (fontData) return measureText(wordText, fontData, run.fontSize || line.fontSize);
  }
  return wg.reduce((s, g) => s + g.glyph.width, 0);
}

export function lineHasAnomalousIntraWordGaps(line: TextLine): boolean {
  const allGlyphs = collectLineGlyphs(line);
  if (allGlyphs.length < 2) return false;
  const words = splitWords(line.text);
  for (let wi = 0; wi < words.length; wi++) {
    const wg = glyphsForRange(allGlyphs, words[wi].start, words[wi].end);
    for (let gi = 1; gi < wg.length; gi++) {
      const prev = wg[gi - 1].glyph;
      const cur = wg[gi].glyph;
      const gap = cur.tRm.e - (prev.tRm.e + prev.width);
      const fs = cur.fontSize || line.fontSize;
      if (shouldSuppressGap(cur, gap, fs)) return true;
    }
  }
  return false;
}

function packPunctAtNativeWordOrigins(
  line: TextLine,
  allGlyphs: IndexedGlyph[],
  words: Array<{ start: number; end: number }>,
): FlowGlyphDraw[] {
  const baseline = line.baseline;
  const result: FlowGlyphDraw[] = [];
  for (let wi = 0; wi < words.length; wi++) {
    const wg = glyphsForRange(allGlyphs, words[wi].start, words[wi].end);
    if (wg.length === 0) continue;
    packWordGlyphs(wg, wg[0].glyph.tRm.e, baseline, result);
  }
  const placed = new Set(result.map(r => r.glyph));
  for (const g of allGlyphs) {
    if (placed.has(g.glyph)) continue;
    if (g.glyph.unicode === ' ' || g.glyph.unicode === '\u00A0') continue;
    result.push({ glyph: g.glyph, run: g.run, x: g.glyph.tRm.e, f: g.glyph.tRm.f ?? baseline });
  }
  result.sort((a, b) => a.x - b.x || a.f - b.f);
  return result;
}

/**
 * Even out inter-word gaps across a body line.
 * Preserves bullet indent; packs trailing punctuation inside words.
 */
function justifyLinePositions(
  line: TextLine,
  allGlyphs: IndexedGlyph[],
  words: Array<{ start: number; end: number }>,
  fonts?: Map<string, FontData>,
): FlowGlyphDraw[] {
  const wordGlyphsList = words.map(w => glyphsForRange(allGlyphs, w.start, w.end));
  const wordTexts = words.map(w => line.text.substring(w.start, w.end));
  const widths = wordGlyphsList.map((wg, wi) => wordWidth(wg, wordTexts[wi], line, fonts));
  const baseline = line.baseline;
  const result: FlowGlyphDraw[] = [];

  // Keep leading bullet at its native x and preserve native gap after it
  let startIdx = 0;
  let x = allGlyphs[0]?.glyph.tRm.e ?? line.leftMargin;

  if (
    wordGlyphsList.length > 0 &&
    wordGlyphsList[0].length > 0 &&
    BULLET_CHARS.test(wordGlyphsList[0][0].glyph.unicode)
  ) {
    // Keep bullet + its native indent to the first word
    packWordGlyphs(wordGlyphsList[0], wordGlyphsList[0][0].glyph.tRm.e, baseline, result);
    if (wordGlyphsList.length > 1 && wordGlyphsList[1].length > 0) {
      x = wordGlyphsList[1][0].glyph.tRm.e;
    }
    startIdx = 1;
  } else if (wordGlyphsList.length > 0 && wordGlyphsList[0].length > 0) {
    x = wordGlyphsList[0][0].glyph.tRm.e;
  }

  const remaining = wordGlyphsList.length - startIdx;
  if (remaining <= 0) return result;

  // Target right edge: use the native right edge of the line content
  let nativeRight = line.rightEdge;
  for (let i = startIdx; i < wordGlyphsList.length; i++) {
    const wg = wordGlyphsList[i];
    if (wg.length === 0) continue;
    const last = wg[wg.length - 1].glyph;
    nativeRight = Math.max(nativeRight, last.tRm.e + last.width);
  }

  const totalWordW = widths.slice(startIdx).reduce((s, w) => s + w, 0);
  const numGaps = remaining - 1;
  const span = nativeRight - x;
  const normalSpace = Math.max(line.fontSize * 0.25, 2);

  // Even to the *median* of native gaps — do NOT expand leftover space into
  // rivers (that happened when packed words got narrower than native).
  const nativeGaps: number[] = [];
  for (let i = startIdx; i < wordGlyphsList.length - 1; i++) {
    const a = wordGlyphsList[i];
    const b = wordGlyphsList[i + 1];
    if (a.length === 0 || b.length === 0) continue;
    const gap =
      b[0].glyph.tRm.e -
      (a[a.length - 1].glyph.tRm.e + a[a.length - 1].glyph.width);
    if (gap > 0) nativeGaps.push(gap);
  }
  let evenGap = normalSpace;
  if (nativeGaps.length > 0) {
    const sorted = [...nativeGaps].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    evenGap = Math.min(Math.max(median, normalSpace * 0.85), normalSpace * 1.35);
  } else if (numGaps > 0 && span > totalWordW) {
    const g = (span - totalWordW) / numGaps;
    evenGap = Math.min(Math.max(g, normalSpace * 0.85), normalSpace * 1.35);
  }

  for (let wi = startIdx; wi < wordGlyphsList.length; wi++) {
    const wg = wordGlyphsList[wi];
    if (wg.length > 0) {
      x = packWordGlyphs(wg, x, baseline, result);
    }
    if (wi < wordGlyphsList.length - 1) {
      x += evenGap;
    }
  }

  return result;
}

export function computeFlowDrawPositions(
  line: TextLine,
  fonts?: Map<string, FontData>,
): FlowGlyphDraw[] {
  // Never rewrite project/title meta lines — native positions keep
  // spaces after ")" / "|" / link icons intact.
  if (isStructuredTitleLine(line)) {
    return naturalPositions(line);
  }

  const packPunct = lineHasAnomalousIntraWordGaps(line);
  const justify = shouldUseFlowDraw(line);

  if (!packPunct && !justify) {
    return naturalPositions(line);
  }

  if (line.runs.length === 0) return naturalPositions(line);

  const allGlyphs = collectLineGlyphs(line);
  if (allGlyphs.length === 0) return [];

  const words = splitWords(line.text);
  if (words.length === 0) return naturalPositions(line);

  if (justify && words.length > 1) {
    return justifyLinePositions(line, allGlyphs, words, fonts);
  }

  if (packPunct) {
    return packPunctAtNativeWordOrigins(line, allGlyphs, words);
  }

  return naturalPositions(line);
}

export function shouldPackLine(line: TextLine): boolean {
  if (isStructuredTitleLine(line)) return false;
  return shouldUseFlowDraw(line) || lineHasAnomalousIntraWordGaps(line);
}

/** Mirror of justification-detect structured-title guard (local to avoid cycles). */
function isStructuredTitleLine(line: TextLine): boolean {
  const text = line.text;
  if (text.includes('|')) return true;
  for (let i = 0; i < line.runs.length; i++) {
    if (line.runs[i].isUnderline) return true;
  }
  if (/\(Open Source\)/i.test(text) && !BULLET_CHARS.test(text.trim()[0] ?? '')) {
    return true;
  }
  if (/https?:\/\/|www\.|linkedin\.com|github\.com|mailto:/i.test(text)) return true;
  if (/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i.test(text)) return true;
  if (/\+?\d[\d\s().-]{8,}\d/.test(text)) return true;
  if (/\b(portfolio|linkedin|github|phone|email|mobile)\b/i.test(text)) return true;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= 4 && line.fontSize >= 16) return true;
  if (line.runs.length >= 5 && words.length <= 12) {
    const tinyRuns = line.runs.filter(r => r.text.trim().length <= 2).length;
    if (tinyRuns >= 3) return true;
  }
  return false;
}

export function buildLineDrawMap(
  line: TextLine,
  fonts?: Map<string, FontData>,
): Map<TextRun, FlowGlyphDraw[]> {
  const positions = computeFlowDrawPositions(line, fonts);
  const map = new Map<TextRun, FlowGlyphDraw[]>();
  for (const pos of positions) {
    const list = map.get(pos.run) ?? [];
    list.push(pos);
    map.set(pos.run, list);
  }
  return map;
}

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

  for (const line of lines) {
    for (const run of line.runs) runToLine.set(run, line);
    if (shouldPackLine(line)) {
      justifiedLines.add(line);
      drawMaps.set(line, buildLineDrawMap(line, fonts));
    }
  }

  return { runToLine, justifiedLines, drawMaps };
}
