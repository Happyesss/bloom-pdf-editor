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
  type PDFDocumentData,
  type PDFObject,
  type PDFPageInfo,
} from '../types';
import type { TextRun } from '../content/interpreter';
import { getPageContentBytes, resolveRef } from '../parser/parser';
import { compileInstructions, type EditResult } from '../editor/text-editor';
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
  const targets = hits.map(h => h.segment.run);
  if (targets.length === 0) {
    return {
      newContentBytes: contentBytes,
      needsFontAugmentation: false,
      missingCharCodes: [],
      usedSyntheticItalic: false,
      addedUnderline: false,
      removedUnderline: false,
    };
  }

  let bytes = contentBytes;
  let addedUnderline = false;
  let removedUnderline = false;

  // Deduplicate runs (multiple hits can share a run)
  const seen = new Set<TextRun>();
  for (const run of targets) {
    if (seen.has(run)) continue;
    seen.add(run);
    const patched = patchRunStyle(bytes, run, style, page, objects);
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

  // Color: patch or insert rg just after BT
  if (style.color) {
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

    // Re-find range after possible splices above
    const range2 = findBtEtRange(instructions, textIndex) ?? range;

    for (let i = textIndex; i >= range2.bt; i--) {
      if (instructions[i].operator === 'Tf' && instructions[i].operands.length >= 2) {
        if (style.fontSize != null) {
          const tfSize = instructions[i].operands[1];
          const curTf = tfSize instanceof PDFNumber ? tfSize.value : run.fontSize;
          const visual = visualFontSize(run);
          // Resumes often use `1 Tf` + scaled Tm. Changing Tf to the visual
          // size would double-scale — scale Tm instead when Tf is a unit size.
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

  // Underline: add stroke after ET, or remove a stroke we previously inserted
  if (style.underline === true) {
    const color = style.color ?? run.fillColor ?? [0, 0, 0];
    const y = run.y - visualFontSize(run) * 0.12;
    const w = Math.max(run.width, visualFontSize(run) * 0.5 * Math.max(1, run.text.length));
    const ul: CSInstruction[] = [
      op('q'),
      op('RG', [new PDFNumber(color[0]), new PDFNumber(color[1]), new PDFNumber(color[2])]),
      op('w', [new PDFNumber(Math.max(0.4, visualFontSize(run) * 0.05))]),
      op('m', [new PDFNumber(run.x), new PDFNumber(y)]),
      op('l', [new PDFNumber(run.x + w), new PDFNumber(y)]),
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
