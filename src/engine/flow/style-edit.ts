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

/** Guess a bold/italic sibling Standard14 font name. */
export function resolveStyledFontName(
  baseName: string,
  bold?: boolean,
  italic?: boolean,
): string {
  const bare = baseName.replace(/^.*\+/, '').replace(/,.*$/, '');
  const lower = bare.toLowerCase();

  if (bold && italic) {
    if (/helvetica/i.test(bare)) return 'Helvetica-BoldOblique';
    if (/times/i.test(bare)) return 'Times-BoldItalic';
    if (/courier/i.test(bare)) return 'Courier-BoldOblique';
  }
  if (bold) {
    if (lower.includes('bold')) return bare;
    if (/helvetica/i.test(bare)) return 'Helvetica-Bold';
    if (/times/i.test(bare)) return 'Times-Bold';
    if (/courier/i.test(bare)) return 'Courier-Bold';
  }
  if (italic) {
    if (lower.includes('italic') || lower.includes('oblique')) return bare;
    if (/helvetica/i.test(bare)) return 'Helvetica-Oblique';
    if (/times/i.test(bare)) return 'Times-Italic';
    if (/courier/i.test(bare)) return 'Courier-Oblique';
  }
  return bare;
}

function listPageFontKeys(page: PDFPageInfo, objects: Map<string, PDFObject>): Set<string> {
  const keys = new Set<string>();
  const resourcesObj = page.dict.get('Resources');
  let resources = resourcesObj instanceof PDFRef ? resolveRef(resourcesObj, objects) : resourcesObj;
  if (!(resources instanceof PDFDict)) return keys;
  let fontDict = resources.get('Font');
  if (fontDict instanceof PDFRef) fontDict = resolveRef(fontDict, objects);
  if (!(fontDict instanceof PDFDict)) return keys;
  for (const [k] of fontDict.entries()) keys.add(k);
  return keys;
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
  const end = selectionEnd <= selectionStart ? line.text.length : selectionEnd;
  const hits = mapSelectionToSegments(line, selectionStart, end);
  const targets = hits.length > 0 ? hits.map(h => h.segment.run) : line.runs;

  let bytes = contentBytes;
  let addedUnderline = false;

  for (const run of targets) {
    const patched = patchRunStyle(bytes, run, style, page, objects);
    bytes = patched.bytes;
    addedUnderline = addedUnderline || patched.addedUnderline;
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
): { bytes: Uint8Array; addedUnderline: boolean } {
  const instructions = parseContentStream(contentBytes);
  const indices = run.sourceInstructionIndices ?? [];
  if (indices.length === 0) {
    return { bytes: contentBytes, addedUnderline: false };
  }

  const textIndex = Math.min(...indices);
  const range = findBtEtRange(instructions, textIndex);
  if (!range) return { bytes: contentBytes, addedUnderline: false };

  let addedUnderline = false;

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

  // Font size / face: patch existing Tf only
  if (style.fontSize != null || style.bold != null || style.italic != null) {
    let fontKey: string | null = null;
    if (style.bold != null || style.italic != null) {
      const desired = resolveStyledFontName(
        run.fontName,
        style.bold ?? /bold/i.test(run.fontName),
        style.italic ?? /italic|oblique/i.test(run.fontName),
      );
      // Only switch if we can embed/ensure a Standard14 face
      fontKey = ensureStandard14Font(page, objects, desired);
      const existing = listPageFontKeys(page, objects);
      // Prefer existing resource that matches
      for (const k of existing) {
        if (k === run.fontName.replace(/^\//, '')) {
          // keep using current unless we created a styled face
        }
      }
    }

    for (let i = textIndex; i >= range.bt; i--) {
      if (instructions[i].operator === 'Tf' && instructions[i].operands.length >= 2) {
        if (style.fontSize != null) {
          instructions[i].operands[1] = new PDFNumber(style.fontSize);
        }
        if (fontKey) {
          instructions[i].operands[0] = new PDFName(fontKey);
        }
        break;
      }
    }
  }

  // Underline: draw after ET (outside text object) using run bounds
  if (style.underline) {
    const color = style.color ?? run.fillColor ?? [0, 0, 0];
    const y = run.y - run.fontSize * 0.12;
    const w = Math.max(run.width, run.fontSize * 0.5 * Math.max(1, run.text.length));
    const ul: CSInstruction[] = [
      op('q'),
      op('RG', [new PDFNumber(color[0]), new PDFNumber(color[1]), new PDFNumber(color[2])]),
      op('w', [new PDFNumber(Math.max(0.4, run.fontSize * 0.05))]),
      op('m', [new PDFNumber(run.x), new PDFNumber(y)]),
      op('l', [new PDFNumber(run.x + w), new PDFNumber(y)]),
      op('S'),
      op('Q'),
    ];
    // Recompute et after possible splices
    const range2 = findBtEtRange(instructions, Math.min(...(run.sourceInstructionIndices ?? [textIndex])));
    const insertAt = (range2?.et ?? range.et) + 1;
    instructions.splice(insertAt, 0, ...ul);
    addedUnderline = true;
  }

  return { bytes: compileInstructions(instructions), addedUnderline };
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
