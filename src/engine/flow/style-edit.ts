/**
 * Style mutation API — safely patch color / size / underline on existing runs.
 *
 * Rules to avoid corrupting PDFs:
 * - Only modify operators already inside the run's BT…ET block
 * - Never invent font resource names that aren't on the page
 * - Never inject synthetic Tm shear (breaks baselines)
 * - Bold/italic only when a sibling Standard14 / resource font exists
 */

import {
  PDFName,
  PDFNumber,
  PDFDict,
  PDFRef,
  PDFString,
  type PDFDocumentData,
  type PDFObject,
  type PDFPageInfo,
} from '../types';
import type { TextRun } from '../content/interpreter';
import { getPageContentBytes, resolveRef } from '../parser/parser';
import {
  compileInstructions,
  encodeTextForFont,
  loadFontForName,
  type EditResult,
} from '../editor/text-editor';
import { updatePageContent } from '../editor/stream-compiler';
import { parseContentStream, type CSInstruction } from '../content/operator-lexer';
import type { TextLine, StyledSegment } from './types';
import { fontNameStyleFlags, visualFontSize } from './metrics';

export interface TextStylePatch {
  fontSize?: number;
  /** RGB in 0–1 */
  color?: [number, number, number];
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  align?: 'left' | 'center' | 'right';
}

export interface StyleEditResult extends EditResult {
  usedSyntheticItalic?: boolean;
  addedUnderline?: boolean;
  removedUnderline?: boolean;
}

function op(operator: string, operands: PDFObject[] = []): CSInstruction {
  return { operator, operands, offset: 0 };
}

/** Map a line-level [start,end) selection onto per-segment ranges. */
export function mapSelectionToSegments(
  line: TextLine,
  selectionStart: number,
  selectionEnd: number,
): Array<{ segment: StyledSegment; localStart: number; localEnd: number }> {
  const start = Math.max(0, Math.min(selectionStart, line.text.length));
  const end = Math.max(start, Math.min(selectionEnd, line.text.length));
  const hits: Array<{ segment: StyledSegment; localStart: number; localEnd: number }> = [];

  for (const seg of line.segments) {
    const overlapStart = Math.max(start, seg.startIndex);
    const overlapEnd = Math.min(end, seg.endIndex);
    if (overlapStart < overlapEnd) {
      hits.push({
        segment: seg,
        localStart: overlapStart - seg.startIndex,
        localEnd: overlapEnd - seg.startIndex,
      });
    }
  }
  return hits;
}

/** Strip weight/style tokens so we can rebuild a Regular/Bold/Italic face name. */
function stripStyleTokens(name: string): string {
  return name
    .replace(/^.*\+/, '')
    .replace(/,.*$/, '')
    .replace(/[-_]?(BoldOblique|BoldItalic|Bold|Black|Heavy|SemiBold|DemiBold|Italic|Oblique|Regular|Medium|Light)/gi, '')
    .replace(/[-_]+$/g, '') || name.replace(/^.*\+/, '');
}

/** Guess a bold/italic sibling Standard14 (or family) font name. */
export function resolveStyledFontName(
  baseName: string,
  bold?: boolean,
  italic?: boolean,
): string {
  const bare = baseName.replace(/^.*\+/, '').replace(/,.*$/, '');
  const family = stripStyleTokens(bare);
  const wantBold = !!bold;
  const wantItalic = !!italic;

  if (/helvetica/i.test(family) || /^arial$/i.test(family)) {
    if (wantBold && wantItalic) return 'Helvetica-BoldOblique';
    if (wantBold) return 'Helvetica-Bold';
    if (wantItalic) return 'Helvetica-Oblique';
    return 'Helvetica';
  }
  if (/times/i.test(family) || /roman/i.test(family)) {
    if (wantBold && wantItalic) return 'Times-BoldItalic';
    if (wantBold) return 'Times-Bold';
    if (wantItalic) return 'Times-Italic';
    return 'Times-Roman';
  }
  if (/courier/i.test(family)) {
    if (wantBold && wantItalic) return 'Courier-BoldOblique';
    if (wantBold) return 'Courier-Bold';
    if (wantItalic) return 'Courier-Oblique';
    return 'Courier';
  }

  // Generic PostScript-style face name
  if (wantBold && wantItalic) return `${family}-BoldItalic`;
  if (wantBold) return `${family}-Bold`;
  if (wantItalic) return `${family}-Italic`;
  return family || bare;
}

function listPageFonts(
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
): Array<{ key: string; baseFont: string }> {
  const out: Array<{ key: string; baseFont: string }> = [];
  const resourcesObj = page.dict.get('Resources');
  let resources = resourcesObj instanceof PDFRef ? resolveRef(resourcesObj, objects) : resourcesObj;
  if (!(resources instanceof PDFDict)) return out;
  let fontDict = resources.get('Font');
  if (fontDict instanceof PDFRef) fontDict = resolveRef(fontDict, objects);
  if (!(fontDict instanceof PDFDict)) return out;
  for (const [k, v] of fontDict.entries()) {
    let dict = v;
    if (dict instanceof PDFRef) dict = resolveRef(dict, objects);
    const baseFont =
      dict instanceof PDFDict ? (dict.getName('BaseFont') ?? k) : k;
    out.push({ key: k, baseFont });
  }
  return out;
}

/**
 * Prefer an existing page font whose BaseFont matches the desired weight/style
 * and the same family as the current run.
 */
function findSiblingFontKey(
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  currentFontName: string,
  wantBold: boolean,
  wantItalic: boolean,
): string | null {
  const fonts = listPageFonts(page, objects);
  const current = fonts.find(f => f.key === currentFontName.replace(/^\//, ''))
    ?? fonts.find(f => f.baseFont === currentFontName);
  const family = stripStyleTokens(current?.baseFont || currentFontName).toLowerCase();

  let best: string | null = null;
  let bestScore = -1;
  for (const f of fonts) {
    const flags = fontNameStyleFlags(f.baseFont);
    if (flags.bold !== wantBold || flags.italic !== wantItalic) continue;
    const fFamily = stripStyleTokens(f.baseFont).toLowerCase();
    let score = 0;
    if (fFamily === family) score += 10;
    else if (fFamily.includes(family) || family.includes(fFamily)) score += 5;
    else continue;
    if (score > bestScore) {
      bestScore = score;
      best = f.key;
    }
  }
  return best;
}

function ensureStandard14Font(
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  baseFont: string,
): string | null {
  const resourceKey = baseFont.replace(/[^A-Za-z0-9]/g, '').slice(0, 16) || 'FStyled';
  const resourcesObj = page.dict.get('Resources');
  let resources = resourcesObj instanceof PDFRef ? resolveRef(resourcesObj, objects) : resourcesObj;
  if (!(resources instanceof PDFDict)) {
    resources = new PDFDict();
    page.dict.set('Resources', resources);
  }
  let fontDict = resources.get('Font');
  if (fontDict instanceof PDFRef) fontDict = resolveRef(fontDict, objects);
  if (!(fontDict instanceof PDFDict)) {
    fontDict = new PDFDict();
    resources.set('Font', fontDict);
  }
  if (fontDict.has(resourceKey)) return resourceKey;

  const allowed = /^(Helvetica|Times-Roman|Times|Courier)/i.test(baseFont);
  if (!allowed) return null;

  const dict = new PDFDict();
  dict.set('Type', new PDFName('Font'));
  dict.set('Subtype', new PDFName('Type1'));
  dict.set('BaseFont', new PDFName(baseFont));
  fontDict.set(resourceKey, dict);
  return resourceKey;
}

/**
 * Apply style to a character range on a line — safe in-BT patches only.
 */
export function applyStyleToSelection(
  contentBytes: Uint8Array,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  line: TextLine,
  selectionStart: number,
  selectionEnd: number,
  style: TextStylePatch,
): StyleEditResult {
  const start = Math.max(0, Math.min(selectionStart, line.text.length));
  const end = Math.max(start, Math.min(selectionEnd, line.text.length));
  // Collapsed ranges are a no-op here — callers must expand to a segment/line first.
  const hits = end > start ? mapSelectionToSegments(line, start, end) : [];
  if (hits.length === 0) {
    return {
      newContentBytes: contentBytes,
      needsFontAugmentation: false,
      missingCharCodes: [],
      usedSyntheticItalic: false,
      addedUnderline: false,
      removedUnderline: false,
    };
  }

  // Merge overlapping local ranges per run so partial bold/italic can split once.
  const byRun = new Map<TextRun, { localStart: number; localEnd: number }>();
  for (const h of hits) {
    const prev = byRun.get(h.segment.run);
    if (!prev) {
      byRun.set(h.segment.run, { localStart: h.localStart, localEnd: h.localEnd });
    } else {
      prev.localStart = Math.min(prev.localStart, h.localStart);
      prev.localEnd = Math.max(prev.localEnd, h.localEnd);
    }
  }

  let bytes = contentBytes;
  let addedUnderline = false;
  let removedUnderline = false;

  for (const [run, range] of byRun) {
    const patched = patchRunStyle(
      bytes, run, style, page, objects, range.localStart, range.localEnd,
    );
    bytes = patched.bytes;
    addedUnderline = addedUnderline || patched.addedUnderline;
    removedUnderline = removedUnderline || patched.removedUnderline;
  }

  if (style.align && line.runs.length > 0) {
    bytes = applyAlignmentShift(bytes, line, style.align);
  }

  return {
    newContentBytes: bytes,
    needsFontAugmentation: false,
    missingCharCodes: [],
    usedSyntheticItalic: false,
    addedUnderline,
    removedUnderline,
  };
}

export function applyStyleToLine(
  contentBytes: Uint8Array,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  line: TextLine,
  style: TextStylePatch,
): StyleEditResult {
  return applyStyleToSelection(contentBytes, page, objects, line, 0, line.text.length, style);
}

export async function applyStyleToSelectionOnPage(
  doc: PDFDocumentData,
  pageIndex: number,
  line: TextLine,
  selectionStart: number,
  selectionEnd: number,
  style: TextStylePatch,
): Promise<StyleEditResult> {
  const page = doc.pages[pageIndex];
  const contentBytes = getPageContentBytes(page, doc.objects);
  const result = applyStyleToSelection(
    contentBytes, page, doc.objects, line, selectionStart, selectionEnd, style,
  );
  await updatePageContent(page.contentRefs, result.newContentBytes, doc.objects);
  return result;
}

function findBtEtRange(
  instructions: CSInstruction[],
  textIndex: number,
): { bt: number; et: number } | null {
  let bt = -1;
  for (let i = textIndex; i >= 0; i--) {
    if (instructions[i].operator === 'ET') return null;
    if (instructions[i].operator === 'BT') { bt = i; break; }
  }
  if (bt < 0) return null;
  let et = -1;
  for (let i = textIndex; i < instructions.length; i++) {
    if (instructions[i].operator === 'ET') { et = i; break; }
  }
  if (et < 0) return null;
  return { bt, et };
}

function patchRunStyle(
  contentBytes: Uint8Array,
  run: TextRun,
  style: TextStylePatch,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  localStart = 0,
  localEnd = run.text.length,
): { bytes: Uint8Array; addedUnderline: boolean; removedUnderline: boolean } {
  const instructions = parseContentStream(contentBytes);
  const indices = run.sourceInstructionIndices ?? [];
  if (indices.length === 0) {
    return { bytes: contentBytes, addedUnderline: false, removedUnderline: false };
  }

  const textIndex = Math.min(...indices);
  const range = findBtEtRange(instructions, textIndex);
  if (!range) return { bytes: contentBytes, addedUnderline: false, removedUnderline: false };

  let addedUnderline = false;
  let removedUnderline = false;

  const clampStart = Math.max(0, Math.min(localStart, run.text.length));
  const clampEnd = Math.max(clampStart, Math.min(localEnd, run.text.length));
  const isPartial = clampStart > 0 || clampEnd < run.text.length;

  // Color: patch or insert rg just after BT (whole-run; partial color uses split path)
  if (style.color && !isPartial) {
    const [r, g, b] = style.color;
    let found = false;
    for (let i = range.bt + 1; i < textIndex; i++) {
      if (instructions[i].operator === 'rg' || instructions[i].operator === 'RG') {
        instructions[i].operands = [new PDFNumber(r), new PDFNumber(g), new PDFNumber(b)];
        found = true;
        break;
      }
    }
    if (!found) {
      instructions.splice(range.bt + 1, 0, op('rg', [
        new PDFNumber(r), new PDFNumber(g), new PDFNumber(b),
      ]));
    }
  }

  // Font size / face: patch existing Tf / Tm only
  if (style.fontSize != null || style.bold != null || style.italic != null) {
    let fontKey: string | null = null;
    if (style.bold != null || style.italic != null) {
      const currentFlags = fontNameStyleFlags(run.fontName);
      const wantBold = style.bold ?? currentFlags.bold;
      const wantItalic = style.italic ?? currentFlags.italic;

      // 1) Prefer a sibling already on the page (embedded resume fonts)
      fontKey = findSiblingFontKey(page, objects, run.fontName, wantBold, wantItalic);

      // 2) Fall back to Standard14 face we can inject
      if (!fontKey) {
        const desired = resolveStyledFontName(run.fontName, wantBold, wantItalic);
        fontKey = ensureStandard14Font(page, objects, desired);
      }
    }

    // Partial bold/italic: split the Tj into before/mid/after with different Tf
    if (isPartial && fontKey && (style.bold != null || style.italic != null)) {
      const splitOk = splitRunTextStyle(
        instructions, run, textIndex, clampStart, clampEnd, fontKey, page, objects,
      );
      if (splitOk) {
        // Still allow underline patches below
      } else {
        // Fall through to whole-run patch if split failed
        applyWholeRunFontPatch(instructions, run, textIndex, range, style, fontKey);
      }
    } else {
      applyWholeRunFontPatch(instructions, run, textIndex, range, style, fontKey);
    }
  }

  // Underline: add stroke after ET, or remove a stroke we previously inserted
  if (style.underline === true) {
    const color = style.color ?? run.fillColor ?? [0, 0, 0];
    const y = run.y - visualFontSize(run) * 0.12;
    const startX = run.x + widthUpToChar(run, clampStart);
    const endX = run.x + widthUpToChar(run, clampEnd);
    const w = Math.max(endX - startX, visualFontSize(run) * 0.5);
    const ul: CSInstruction[] = [
      op('q'),
      op('RG', [new PDFNumber(color[0]), new PDFNumber(color[1]), new PDFNumber(color[2])]),
      op('w', [new PDFNumber(Math.max(0.4, visualFontSize(run) * 0.05))]),
      op('m', [new PDFNumber(startX), new PDFNumber(y)]),
      op('l', [new PDFNumber(startX + w), new PDFNumber(y)]),
      op('S'),
      op('Q'),
    ];
    const range2 = findBtEtRange(instructions, Math.min(...(run.sourceInstructionIndices ?? [textIndex])));
    const insertAt = (range2?.et ?? range.et) + 1;
    instructions.splice(insertAt, 0, ...ul);
    addedUnderline = true;
  } else if (style.underline === false) {
    removedUnderline = removeUnderlineNearRun(instructions, run) || removedUnderline;
  }

  return { bytes: compileInstructions(instructions), addedUnderline, removedUnderline };
}

function applyWholeRunFontPatch(
  instructions: CSInstruction[],
  run: TextRun,
  textIndex: number,
  range: { bt: number; et: number },
  style: TextStylePatch,
  fontKey: string | null,
): void {
  const range2 = findBtEtRange(instructions, textIndex) ?? range;

  for (let i = textIndex; i >= range2.bt; i--) {
    if (instructions[i].operator === 'Tf' && instructions[i].operands.length >= 2) {
      if (style.fontSize != null) {
        const tfSize = instructions[i].operands[1];
        const curTf = tfSize instanceof PDFNumber ? tfSize.value : run.fontSize;
        const visual = visualFontSize(run);
        if (curTf > 0 && curTf <= 1.5 && Math.abs(visual - curTf) > 1) {
          const scale = style.fontSize / visual;
          for (let j = textIndex; j >= range2.bt; j--) {
            if (instructions[j].operator === 'Tm' && instructions[j].operands.length >= 6) {
              for (const idx of [0, 1, 2, 3]) {
                const n = instructions[j].operands[idx];
                if (n instanceof PDFNumber) {
                  instructions[j].operands[idx] = new PDFNumber(n.value * scale);
                }
              }
              break;
            }
          }
        } else {
          instructions[i].operands[1] = new PDFNumber(style.fontSize);
        }
      }
      if (fontKey) {
        instructions[i].operands[0] = new PDFName(fontKey);
      }
      break;
    }
  }
}

function widthUpToChar(run: TextRun, charCount: number): number {
  if (charCount <= 0) return 0;
  if (!run.glyphs.length) {
    return (run.width / Math.max(1, run.text.length)) * charCount;
  }
  let w = 0;
  let chars = 0;
  for (const g of run.glyphs) {
    if (chars >= charCount) break;
    w += g.width;
    chars += (g.unicode || '').length || 1;
  }
  return w;
}

/**
 * Split a single Tj/TJ at [localStart, localEnd) and apply a different font to the middle.
 * Keeps surrounding glyphs on the original face — Word-like partial bold/unbold.
 */
function splitRunTextStyle(
  instructions: CSInstruction[],
  run: TextRun,
  textIndex: number,
  localStart: number,
  localEnd: number,
  newFontKey: string,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
): boolean {
  if (textIndex < 0 || textIndex >= instructions.length) return false;
  const inst = instructions[textIndex];
  if (inst.operator !== 'Tj' && inst.operator !== 'TJ' && inst.operator !== "'" && inst.operator !== '"') {
    return false;
  }

  const before = run.text.slice(0, localStart);
  const mid = run.text.slice(localStart, localEnd);
  const after = run.text.slice(localEnd);
  if (!mid) return false;

  const fontData = loadFontForName(run.fontName, page, objects);
  const encBefore = before ? encodeTextForFont(before, fontData) : null;
  const encMid = encodeTextForFont(mid, fontData);
  const encAfter = after ? encodeTextForFont(after, fontData) : null;

  // Find current Tf size to reuse
  let tfSize: PDFObject = new PDFNumber(run.fontSize);
  for (let i = textIndex; i >= 0; i--) {
    if (instructions[i].operator === 'BT') break;
    if (instructions[i].operator === 'Tf' && instructions[i].operands.length >= 2) {
      tfSize = instructions[i].operands[1];
      break;
    }
  }

  const replacement: CSInstruction[] = [];
  // Tj advances the text matrix, so consecutive Tj ops stay on one baseline
  // without Td — inserting Td would double-advance and shift glyphs.
  if (before) {
    replacement.push(op('Tj', [encBefore!.pdfString]));
  }
  replacement.push(op('Tf', [new PDFName(newFontKey), tfSize]));
  replacement.push(op('Tj', [encMid.pdfString]));
  // Always restore the original face so later ops in the same BT stay correct.
  replacement.push(op('Tf', [new PDFName(run.fontName.replace(/^\//, '')), tfSize]));
  if (after) {
    replacement.push(op('Tj', [encAfter!.pdfString]));
  }

  // If the original used TJ with spacing, falling back to Tj is acceptable for the selection.
  instructions.splice(textIndex, 1, ...replacement);
  return true;
}

/** Remove a short horizontal stroke under the run (editor-added underline). */
function removeUnderlineNearRun(instructions: CSInstruction[], run: TextRun): boolean {
  const fs = visualFontSize(run);
  const targetY = run.y - fs * 0.12;
  for (let i = 0; i < instructions.length - 6; i++) {
    if (instructions[i].operator !== 'q') continue;
    // q … m l S Q  — simple underline block
    let mIdx = -1;
    let lIdx = -1;
    let sIdx = -1;
    let qIdx = -1;
    for (let j = i + 1; j < Math.min(i + 10, instructions.length); j++) {
      const opName = instructions[j].operator;
      if (opName === 'm' && mIdx < 0) mIdx = j;
      else if (opName === 'l' && mIdx >= 0 && lIdx < 0) lIdx = j;
      else if (opName === 'S' && lIdx >= 0 && sIdx < 0) sIdx = j;
      else if (opName === 'Q' && sIdx >= 0) { qIdx = j; break; }
      else if (opName === 'q' || opName === 'BT') break;
    }
    if (mIdx < 0 || lIdx < 0 || sIdx < 0 || qIdx < 0) continue;
    const mx = instructions[mIdx].operands[0];
    const my = instructions[mIdx].operands[1];
    const lx = instructions[lIdx].operands[0];
    const ly = instructions[lIdx].operands[1];
    if (!(mx instanceof PDFNumber) || !(my instanceof PDFNumber)) continue;
    if (!(lx instanceof PDFNumber) || !(ly instanceof PDFNumber)) continue;
    if (Math.abs(my.value - ly.value) > 0.5) continue; // not horizontal
    if (Math.abs(my.value - targetY) > fs * 0.35) continue;
    if (Math.abs(mx.value - run.x) > fs * 0.5) continue;
    instructions.splice(i, qIdx - i + 1);
    return true;
  }
  return false;
}

function applyAlignmentShift(
  contentBytes: Uint8Array,
  line: TextLine,
  align: 'left' | 'center' | 'right',
): Uint8Array {
  if (align === 'left' || line.runs.length === 0) return contentBytes;

  const natural = line.width;
  const target = line.rightEdge - line.leftMargin;
  if (target <= 0) return contentBytes;

  let dx = 0;
  if (align === 'center') dx = (target - natural) / 2;
  if (align === 'right') dx = target - natural;
  if (Math.abs(dx) < 0.01) return contentBytes;

  const instructions = parseContentStream(contentBytes);
  const first = line.runs[0];
  const indices = first.sourceInstructionIndices ?? [];
  if (indices.length === 0) return contentBytes;

  const textIndex = Math.min(...indices);
  // Prefer adjusting existing Tm/Td rather than inserting a new Td
  for (let i = textIndex; i >= 0; i--) {
    if (instructions[i].operator === 'BT') break;
    if (instructions[i].operator === 'Tm' && instructions[i].operands.length >= 6) {
      const e = instructions[i].operands[4];
      const cur = e instanceof PDFNumber ? e.value : 0;
      instructions[i].operands[4] = new PDFNumber(cur + dx);
      return compileInstructions(instructions);
    }
    if ((instructions[i].operator === 'Td' || instructions[i].operator === 'TD') && instructions[i].operands.length >= 2) {
      const x = instructions[i].operands[0];
      const cur = x instanceof PDFNumber ? x.value : 0;
      instructions[i].operands[0] = new PDFNumber(cur + dx);
      return compileInstructions(instructions);
    }
  }
  return contentBytes;
}

/**
 * Duplicate a text line below itself (same glyphs, shifted down by line height).
 * Useful for table-like rows and form-style label lines.
 */
export function duplicateLineBelow(
  contentBytes: Uint8Array,
  line: TextLine,
  dyOverride?: number,
): Uint8Array {
  const instructions = parseContentStream(contentBytes);
  const dy = dyOverride ?? -(Math.max(
    line.runs[0] ? visualFontSize(line.runs[0]) : line.fontSize,
    line.fontSize,
  ) * 1.35);
  const clones: CSInstruction[] = [];
  const seenRanges = new Set<string>();

  for (const run of line.runs) {
    const indices = run.sourceInstructionIndices ?? [];
    if (indices.length === 0) continue;
    const textIndex = Math.min(...indices);
    const range = findBtEtRange(instructions, textIndex);
    if (!range) continue;
    const key = `${range.bt}:${range.et}`;
    if (seenRanges.has(key)) continue;
    seenRanges.add(key);

    const slice = instructions.slice(range.bt, range.et + 1).map(cloneInstruction);
    shiftInstructionsY(slice, dy);
    clones.push(...slice);
  }

  if (clones.length === 0) {
    // Fallback: inject a fresh text run under the line
    const run = line.runs[0];
    if (!run) return contentBytes;
    const color = run.fillColor ?? [0, 0, 0];
    const fs = visualFontSize(run);
    clones.push(
      op('q'),
      op('BT'),
      op('rg', [new PDFNumber(color[0]), new PDFNumber(color[1]), new PDFNumber(color[2])]),
      op('Tf', [new PDFName(run.fontName.replace(/^\//, '')), new PDFNumber(run.fontSize || fs)]),
      op('Tm', [
        new PDFNumber(1), new PDFNumber(0), new PDFNumber(0), new PDFNumber(1),
        new PDFNumber(run.x), new PDFNumber(run.y + dy),
      ]),
      op('Tj', [new PDFString(line.text)]),
      op('ET'),
      op('Q'),
    );
  }

  instructions.push(...clones);
  return compileInstructions(instructions);
}

/** Duplicate every line in a table row one row-height below (Add Row). */
export function duplicateTableRowBelow(
  contentBytes: Uint8Array,
  rowLines: TextLine[],
): Uint8Array {
  if (rowLines.length === 0) return contentBytes;
  const heights = rowLines.map(l =>
    Math.max(l.fontSize, l.runs[0] ? visualFontSize(l.runs[0]) : l.fontSize) * 1.35,
  );
  const dy = -Math.max(...heights, 14);
  let bytes = contentBytes;
  for (const line of rowLines) {
    bytes = duplicateLineBelow(bytes, line, dy);
  }
  return bytes;
}

/**
 * Add a blank column to the right of a table by inserting empty (or " ") text
 * at each row, aligned after the rightmost cell.
 */
export function insertTableColumnRight(
  contentBytes: Uint8Array,
  rowLines: TextLine[][],
): Uint8Array {
  let bytes = contentBytes;
  for (const row of rowLines) {
    if (row.length === 0) continue;
    const rightmost = [...row].sort((a, b) => b.rightEdge - a.rightEdge)[0];
    const run = rightmost.runs[0];
    if (!run) continue;
    const fs = visualFontSize(run);
    const gap = Math.max(fs * 2.5, 20);
    const x = rightmost.rightEdge + gap;
    const y = run.y;
    const color = run.fillColor ?? [0, 0, 0];
    const instructions = parseContentStream(bytes);
    instructions.push(
      op('q'),
      op('BT'),
      op('rg', [new PDFNumber(color[0]), new PDFNumber(color[1]), new PDFNumber(color[2])]),
      op('Tf', [new PDFName(run.fontName.replace(/^\//, '')), new PDFNumber(run.fontSize || fs)]),
      op('Tm', [
        new PDFNumber(1), new PDFNumber(0), new PDFNumber(0), new PDFNumber(1),
        new PDFNumber(x), new PDFNumber(y),
      ]),
      op('Tj', [new PDFString(' ')]),
      op('ET'),
      op('Q'),
    );
    bytes = compileInstructions(instructions);
  }
  return bytes;
}

function cloneInstruction(inst: CSInstruction): CSInstruction {
  return {
    operator: inst.operator,
    operands: inst.operands.map(o => o),
    offset: 0,
  };
}

function shiftInstructionsY(instructions: CSInstruction[], dy: number): void {
  for (const inst of instructions) {
    if (inst.operator === 'Tm' && inst.operands.length >= 6) {
      const f = inst.operands[5];
      if (f instanceof PDFNumber) inst.operands[5] = new PDFNumber(f.value + dy);
    } else if ((inst.operator === 'Td' || inst.operator === 'TD') && inst.operands.length >= 2) {
      const y = inst.operands[1];
      if (y instanceof PDFNumber) inst.operands[1] = new PDFNumber(y.value + dy);
    } else if ((inst.operator === 'm' || inst.operator === 'l') && inst.operands.length >= 2) {
      const y = inst.operands[1];
      if (y instanceof PDFNumber) inst.operands[1] = new PDFNumber(y.value + dy);
    }
  }
}

