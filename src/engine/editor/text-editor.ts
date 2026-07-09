/**
 * Content Stream Text Editor
 *
 * Modifies text directly in a PDF page's content stream.
 * This is the core "inline editing" capability — what makes this
 * an Adobe Acrobat-class tool rather than a simple viewer.
 *
 * Operations:
 *   - Replace text within a Tj/TJ operator
 *   - Insert new text at a position
 *   - Delete text from a content stream
 *   - Reflow text with adjusted spacing
 *
 * The editor works at the token level: it locates the exact Tj/TJ
 * instruction in the content stream, modifies its operands, and
 * recompiles the stream.
 */

import { parseContentStream, type CSInstruction } from '../content/operator-lexer';
import { interpretPage, type TextRun } from '../content/interpreter';
import {
  PDFArray,
  PDFDict,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFPageInfo,
} from '../types';
import { resolveRef } from '../parser/parser';
import { loadFont, type FontData, charCodeToUnicode } from '../fonts/font-parser';
import { serializeToString } from './stream-compiler';

// ─── Edit operations ────────────────────────────────────────────────────────

export interface TextEdit {
  /** The text run being edited (from the interpreter's display list) */
  targetRun: TextRun;
  /** New text to replace the original */
  newText: string;
}

export interface EditResult {
  /** The modified content stream bytes */
  newContentBytes: Uint8Array;
  /** Whether font augmentation is needed (new glyphs required) */
  needsFontAugmentation: boolean;
  /** Character codes that are missing from the font */
  missingCharCodes: number[];
}

export interface RunPositionShift {
  run: TextRun;
  dx: number;
  dy: number;
}

// ─── Main editing function ──────────────────────────────────────────────────

/**
 * Apply text edits to a page's content stream.
 *
 * @param contentBytes Original decoded content stream bytes
 * @param page Page info for resources
 * @param objects Document object map
 * @param edits Array of text edits to apply
 * @returns Modified content stream bytes
 */
export function applyTextEdits(
  contentBytes: Uint8Array,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  edits: TextEdit[],
): EditResult {
  // Parse the content stream into instructions
  const instructions = parseContentStream(contentBytes);

  // Build a map of text-showing instructions with their byte offsets
  const textInstructions = findTextInstructions(instructions);

  let needsFontAugmentation = false;
  const missingCharCodes: number[] = [];
  let indexOffset = 0;

  // Apply each edit
  for (const edit of edits) {
    // Load font data for encoding
    const fontData = loadFontForRun(edit.targetRun, page, objects);

    // Encode the new text using the font's encoding
    const encoded = encodeTextForFont(edit.newText, fontData);

    if (encoded.missing.length > 0) {
      needsFontAugmentation = true;
      missingCharCodes.push(...encoded.missing);
    }

    const rawIndices = edit.targetRun.sourceInstructionIndices ?? [];

    // Erase the old text region before replacing (prevents overlap with neighbors)
    if (edit.newText !== edit.targetRun.text && rawIndices.length > 0) {
      const inserted = insertEraseRectForRun(
        instructions,
        edit.targetRun,
        edit.newText,
        Math.min(...rawIndices) + indexOffset,
      );
      indexOffset += inserted;
    }

    const sourceInstructionIndices = rawIndices.map(i => i + indexOffset);

    if (sourceInstructionIndices.length > 1) {
      applyGroupedTextEdit(
        instructions,
        sourceInstructionIndices,
        edit.targetRun.text,
        edit.newText,
        fontData,
        page,
        objects,
      );
      continue;
    }

    // Prefer stable index-based matching (immune to fuzzy text match failures)
    let matched: TextInstruction | null = null;
    if (sourceInstructionIndices.length === 1) {
      const idx = sourceInstructionIndices[0];
      const inst = instructions[idx];
      if (inst && isTextShowingOperator(inst.operator)) {
        matched = {
          index: idx,
          instruction: inst,
          fontInstruction: null,
          fontName: edit.targetRun.fontName,
          fontSize: edit.targetRun.fontSize,
          tmX: edit.targetRun.x,
          tmY: edit.targetRun.y,
        };
      }
    }

    if (!matched) {
      matched = matchTextRunToInstruction(
        edit.targetRun,
        textInstructions,
        contentBytes,
        page,
        objects,
      );
    }

    if (!matched) {
      console.warn('[TextEditor] Could not match text run to instruction');
      continue;
    }

    // Replace the operand in the matched instruction
    if (matched.instruction.operator === 'TJ') {
      // Smart TJ editing — preserve spacing pattern from original array
      const oldArr = matched.instruction.operands[0];
      if (oldArr instanceof PDFArray) {
        const newArr = buildSmartTJArray(oldArr, edit.targetRun.text, edit.newText, encoded.pdfString, fontData);
        matched.instruction.operands = [newArr];
      } else {
        matched.instruction.operands = [new PDFArray([encoded.pdfString])];
      }
    } else {
      matched.instruction.operands = [encoded.pdfString];
    }
  }

  // Recompile the instructions back into a content stream
  const newBytes = compileInstructions(instructions);

  return {
    newContentBytes: newBytes,
    needsFontAugmentation,
    missingCharCodes,
  };
}

/**
 * Shift text runs by modifying Tm/Td operands in their BT block.
 * Used by the flow layout layer for horizontal reflow and line push-down.
 */
export function applyRunPositionShifts(
  contentBytes: Uint8Array,
  shifts: RunPositionShift[],
): Uint8Array {
  if (shifts.length === 0) return contentBytes;

  const instructions = parseContentStream(contentBytes);
  const merged = new Map<TextRun, { dx: number; dy: number }>();
  for (let i = 0; i < shifts.length; i++) {
    const s = shifts[i];
    const prev = merged.get(s.run) ?? { dx: 0, dy: 0 };
    prev.dx += s.dx;
    prev.dy += s.dy;
    merged.set(s.run, prev);
  }

  const shiftedOps = new Set<number>();

  merged.forEach((delta, run) => {
    const indices = run.sourceInstructionIndices;
    if (!indices || indices.length === 0) return;

    const textIndex = indices[0];
    const pos = findTextPositionInstruction(instructions, textIndex);
    if (!pos || shiftedOps.has(pos.index)) return;

    const inst = instructions[pos.index];
    if (pos.kind === 'Tm' && inst.operands.length >= 6) {
      inst.operands[4] = new PDFNumber(numVal(inst.operands[4]) + delta.dx);
      inst.operands[5] = new PDFNumber(numVal(inst.operands[5]) + delta.dy);
    } else if (inst.operands.length >= 2) {
      inst.operands[0] = new PDFNumber(numVal(inst.operands[0]) + delta.dx);
      inst.operands[1] = new PDFNumber(numVal(inst.operands[1]) + delta.dy);
    }
    shiftedOps.add(pos.index);
  });

  return compileInstructions(instructions);
}

function findTextPositionInstruction(
  instructions: CSInstruction[],
  textIndex: number,
): { index: number; kind: 'Tm' | 'Td' } | null {
  if (textIndex < 0 || textIndex >= instructions.length) return null;

  let btIndex = -1;
  for (let i = textIndex; i >= 0; i--) {
    if (instructions[i].operator === 'ET') return null;
    if (instructions[i].operator === 'BT') {
      btIndex = i;
      break;
    }
  }
  if (btIndex < 0) return null;

  let last: { index: number; kind: 'Tm' | 'Td' } | null = null;
  for (let i = btIndex; i < textIndex; i++) {
    const op = instructions[i].operator;
    if (op === 'Tm') last = { index: i, kind: 'Tm' };
    else if (op === 'Td' || op === 'TD') last = { index: i, kind: 'Td' };
  }

  return last;
}

/**
 * Inserts a new text run into a page's content stream.
 *
 * @param contentBytes Original decoded content stream bytes
 * @param page Page info for resources
 * @param objects Document object map
 * @param text The new text to insert
 * @param x X coordinate (PDF units)
 * @param y Y coordinate (PDF units)
 * @param fontSize Font size in points
 * @param color RGB color [0-1, 0-1, 0-1]
 * @returns Modified content stream bytes
 */
export function insertTextRun(
  contentBytes: Uint8Array,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: [number, number, number],
): Uint8Array {
  // Ensure the page has the Helv font in its resources
  const resourcesObj = page.dict.get('Resources');
  let resources = resourcesObj instanceof PDFRef ? resolveRef(resourcesObj, objects) : resourcesObj;
  if (!(resources instanceof PDFDict)) {
    resources = new PDFDict();
    page.dict.set('Resources', resources);
  }
  
  const fontObj = resources.get('Font');
  let fontDict = fontObj instanceof PDFRef ? resolveRef(fontObj, objects) : fontObj;
  if (!(fontDict instanceof PDFDict)) {
    fontDict = new PDFDict();
    resources.set('Font', fontDict);
  }
  
  if (!fontDict.has('Helv')) {
    const helvetica = new PDFDict();
    helvetica.set('Type', new PDFName('Font'));
    helvetica.set('Subtype', new PDFName('Type1'));
    helvetica.set('BaseFont', new PDFName('Helvetica'));
    fontDict.set('Helv', helvetica);
  }

  // PDF strings are usually encoded in MacRoman or PDFDocEncoding for standard fonts.
  // For basic text, just convert chars to a PDF string.
  // (In a full implementation, we'd encode correctly using the font's encoding).
  let encodedText = '';
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 256) {
      encodedText += String.fromCharCode(code);
    } else {
      encodedText += '?'; // fallback for unsupported chars in standard font
    }
  }
  const pdfString = new PDFString(encodedText);
  const escaped = serializeToString(pdfString);

  const [r, g, b] = color;
  const injection = `\nq\nBT\n${r} ${g} ${b} rg\n/Helv ${fontSize} Tf\n1 0 0 1 ${x} ${y} Tm\n${escaped} Tj\nET\nQ\n`;
  const enc = new TextEncoder();
  const injectionBytes = enc.encode(injection);

  // Concat using a helper
  const newBytes = new Uint8Array(contentBytes.length + injectionBytes.length);
  newBytes.set(contentBytes);
  newBytes.set(injectionBytes, contentBytes.length);

  return newBytes;
}

// ─── Text instruction matching ──────────────────────────────────────────────

interface TextInstruction {
  instruction: CSInstruction;
  index: number;
  /** The preceding Tf instruction (font selection) */
  fontInstruction: CSInstruction | null;
  /** Font name from the most recent Tf */
  fontName: string;
  /** Font size from the most recent Tf */
  fontSize: number;
  /** Approximate X position from text matrix (user space) */
  tmX: number;
  /** Approximate Y position from text matrix (user space) */
  tmY: number;
}

function numVal(obj: PDFObject | undefined): number {
  return obj instanceof PDFNumber ? obj.value : 0;
}

function findTextInstructions(instructions: CSInstruction[]): TextInstruction[] {
  const result: TextInstruction[] = [];
  let currentFont = '';
  let currentFontSize = 12;
  let lastTfInstruction: CSInstruction | null = null;

  // Track text matrix for position-based matching
  // tm = [a, b, c, d, e, f] where e=x, f=y in user space
  let tmE = 0, tmF = 0;     // text matrix translation (position)
  let tlmE = 0, tlmF = 0;   // text line matrix translation
  let tmA = 1, tmB = 0, tmC = 0, tmD = 1;  // text matrix rotation/scale
  let tlmA = 1, tlmB = 0, tlmC = 0, tlmD = 1;
  let textLeading = 0;

  for (let i = 0; i < instructions.length; i++) {
    const inst = instructions[i];

    switch (inst.operator) {
      case 'BT':
        tmA = 1; tmB = 0; tmC = 0; tmD = 1; tmE = 0; tmF = 0;
        tlmA = 1; tlmB = 0; tlmC = 0; tlmD = 1; tlmE = 0; tlmF = 0;
        break;

      case 'Tm': {
        tmA = numVal(inst.operands[0]); tmB = numVal(inst.operands[1]);
        tmC = numVal(inst.operands[2]); tmD = numVal(inst.operands[3]);
        tmE = numVal(inst.operands[4]); tmF = numVal(inst.operands[5]);
        tlmA = tmA; tlmB = tmB; tlmC = tmC; tlmD = tmD;
        tlmE = tmE; tlmF = tmF;
        break;
      }

      case 'Td': {
        const tx = numVal(inst.operands[0]);
        const ty = numVal(inst.operands[1]);
        // textLineMatrix = translate(tx,ty) * textLineMatrix
        tlmE = tlmA * tx + tlmC * ty + tlmE;
        tlmF = tlmB * tx + tlmD * ty + tlmF;
        tmA = tlmA; tmB = tlmB; tmC = tlmC; tmD = tlmD;
        tmE = tlmE; tmF = tlmF;
        break;
      }

      case 'TD': {
        const tx = numVal(inst.operands[0]);
        const ty = numVal(inst.operands[1]);
        textLeading = -ty;
        tlmE = tlmA * tx + tlmC * ty + tlmE;
        tlmF = tlmB * tx + tlmD * ty + tlmF;
        tmA = tlmA; tmB = tlmB; tmC = tlmC; tmD = tlmD;
        tmE = tlmE; tmF = tlmF;
        break;
      }

      case 'T*': {
        const ty = -textLeading;
        tlmE = tlmC * ty + tlmE;
        tlmF = tlmD * ty + tlmF;
        tmA = tlmA; tmB = tlmB; tmC = tlmC; tmD = tlmD;
        tmE = tlmE; tmF = tlmF;
        break;
      }

      case 'TL':
        textLeading = numVal(inst.operands[0]);
        break;

      case 'Tf':
        currentFont = inst.operands[0] instanceof PDFName ? inst.operands[0].name : '';
        currentFontSize = inst.operands[1] instanceof PDFNumber ? inst.operands[1].value : 12;
        lastTfInstruction = inst;
        break;
    }

    if (inst.operator === 'Tj' || inst.operator === 'TJ' ||
        inst.operator === "'" || inst.operator === '"') {
      result.push({
        instruction: inst,
        index: i,
        fontInstruction: lastTfInstruction,
        fontName: currentFont,
        fontSize: currentFontSize,
        tmX: tmE,
        tmY: tmF,
      });
    }
  }

  return result;
}

/**
 * Match a TextRun (from the interpreter) to the corresponding
 * text instruction in the content stream.
 *
 * We match based on font name and approximate text content.
 */
function matchTextRunToInstruction(
  run: TextRun,
  textInstructions: TextInstruction[],
  contentBytes: Uint8Array,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
): TextInstruction | null {
  // Helper: check if font names are compatible
  const fontsMatch = (tiFontName: string, runFontName: string): boolean => {
    if (runFontName === '' || tiFontName === '') return true;
    if (tiFontName === runFontName) return true;
    return false;
  };

  // 1) Try exact or trimmed match first
  for (const ti of textInstructions) {
    if (!fontsMatch(ti.fontName, run.fontName)) continue;

    const decoded = decodeInstructionText(ti.instruction, ti.fontName, page, objects);
    if (decoded === null) continue;

    if (decoded === run.text || decoded.trim() === run.text.trim()) {
      return ti;
    }
  }

  // 2) Try whitespace-insensitive match
  const runClean = run.text.replace(/\s+/g, '');
  if (runClean.length > 0) {
    for (const ti of textInstructions) {
      if (!fontsMatch(ti.fontName, run.fontName)) continue;

      const decoded = decodeInstructionText(ti.instruction, ti.fontName, page, objects);
      if (decoded === null) continue;

      const decClean = decoded.replace(/\s+/g, '');
      if (decClean === runClean) {
        return ti;
      }
    }
  }

  // 3) Try substring match ONLY if decoded instruction contains the run text (e.g. multi-line TJ array)
  // NEVER check if run.text.includes(decoded), as short/single-character instructions would falsely match!
  for (const ti of textInstructions) {
    if (!fontsMatch(ti.fontName, run.fontName)) continue;

    const decoded = decodeInstructionText(ti.instruction, ti.fontName, page, objects);
    if (decoded === null) continue;

    if (decoded.includes(run.text) && run.text.trim().length > 1) {
      return ti;
    }
  }

  // 4) Normalized comparison — strip all non-alphanumeric characters and compare
  const runNorm = run.text.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  if (runNorm.length > 2) {
    for (const ti of textInstructions) {
      if (!fontsMatch(ti.fontName, run.fontName)) continue;

      const decoded = decodeInstructionText(ti.instruction, ti.fontName, page, objects);
      if (decoded === null) continue;

      const decNorm = decoded.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (decNorm === runNorm) {
        return ti;
      }
    }
  }

  // 5) For single/short text (brackets, special chars, bullet points), try
  //    matching by font name alone when there's a single instruction with that font
  //    that produces similar-length text
  if (run.text.trim().length <= 2 && run.text.trim().length > 0) {
    const candidates = textInstructions.filter(ti => {
      if (!fontsMatch(ti.fontName, run.fontName)) return false;
      const decoded = decodeInstructionText(ti.instruction, ti.fontName, page, objects);
      if (decoded === null) return false;
      return decoded.trim().length <= 3 && decoded.trim().length > 0;
    });
    // If exactly one candidate, return it
    if (candidates.length === 1) {
      return candidates[0];
    }
  }

  return null;
}

function decodeInstructionText(
  instruction: CSInstruction,
  fontName: string,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
): string | null {
  const op = instruction.operator;
  const ops = instruction.operands;

  if (op === 'Tj') {
    return extractStringText(ops[0], fontName, page, objects);
  }

  if (op === 'TJ') {
    const arr = ops[0];
    if (!(arr instanceof PDFArray)) return null;

    let text = '';
    for (let i = 0; i < arr.length; i++) {
      const item = arr.get(i)!;
      if (item instanceof PDFString || item instanceof PDFHexString) {
        text += extractStringText(item, fontName, page, objects) ?? '';
      }
      // Numbers are spacing adjustments — skip
    }
    return text;
  }

  if (op === "'") {
    return extractStringText(ops[0], fontName, page, objects);
  }

  if (op === '"') {
    return extractStringText(ops[2], fontName, page, objects);
  }

  return null;
}

function extractStringText(
  obj: PDFObject | undefined,
  fontName: string,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
): string | null {
  if (!obj) return null;

  let bytes: Uint8Array;
  if (obj instanceof PDFString) {
    bytes = obj.toBytes();
  } else if (obj instanceof PDFHexString) {
    bytes = obj.toBytes();
  } else {
    return null;
  }

  // Load font data for decoding
  const fontData = loadFontForName(fontName, page, objects);
  if (!fontData) {
    // Fallback: decode as Latin-1
    let text = '';
    for (let i = 0; i < bytes.length; i++) {
      text += String.fromCharCode(bytes[i]);
    }
    return text;
  }

  // Decode using font's ToUnicode map
  let text = '';
  const isComposite = fontData.isComposite;
  let idx = 0;

  while (idx < bytes.length) {
    let charCode: number;
    if (isComposite && idx + 1 < bytes.length) {
      charCode = (bytes[idx] << 8) | bytes[idx + 1];
      idx += 2;
    } else {
      charCode = bytes[idx];
      idx += 1;
    }
    text += charCodeToUnicode(charCode, fontData);
  }

  return text;
}

// ─── Text encoding ──────────────────────────────────────────────────────────

interface EncodedText {
  pdfString: PDFObject;
  /** Unicode characters that couldn't be encoded */
  missing: number[];
}

/**
 * Encode a Unicode string into PDF text using the font's encoding.
 * This is the reverse of text extraction — Unicode → character codes.
 */
function encodeTextForFont(text: string, fontData: FontData | null): EncodedText {
  if (!fontData) {
    // No font data — encode as Latin-1
    return {
      pdfString: new PDFString(text),
      missing: [],
    };
  }

  const missing: number[] = [];

  if (fontData.isComposite) {
    // Composite font: build reverse ToUnicode map
    const reverseMap = buildReverseUnicodeMap(fontData);
    let hex = '';

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const code = reverseMap.get(char);
      if (code !== undefined) {
        hex += code.toString(16).padStart(4, '0');
      } else {
        // Character not in font — mark as missing
        missing.push(char.codePointAt(0)!);
        hex += '0000'; // placeholder
      }
    }

    return {
      pdfString: new PDFHexString(hex),
      missing,
    };
  } else {
    // Simple font: use encoding differences or direct mapping
    const reverseMap = buildReverseUnicodeMap(fontData);
    let result = '';

    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      const code = reverseMap.get(char);
      if (code !== undefined) {
        result += String.fromCharCode(code);
      } else {
        // Try direct charCode (Latin-1)
        const cp = char.codePointAt(0)!;
        if (cp < 256) {
          result += char;
        } else {
          missing.push(cp);
          result += '?'; // placeholder
        }
      }
    }

    return {
      pdfString: new PDFString(result),
      missing,
    };
  }
}

function buildReverseUnicodeMap(fontData: FontData): Map<string, number> {
  const reverse = new Map<string, number>();

  // ToUnicode entries take priority
  const entries = Array.from(fontData.toUnicode.entries());
  for (let i = 0; i < entries.length; i++) {
    const [code, unicode] = entries[i];
    reverse.set(unicode, code);
  }

  // Also add encoding differences
  const diffEntries = Array.from(fontData.differences.entries());
  for (let i = 0; i < diffEntries.length; i++) {
    const [code, glyphName] = diffEntries[i];
    // Simple: if the glyph name is a single character, map it
    if (glyphName.length === 1) {
      reverse.set(glyphName, code);
    }
  }

  // For simple fonts, add standard ASCII mapping
  if (!fontData.isComposite) {
    for (let i = 0x20; i <= 0x7e; i++) {
      const char = String.fromCharCode(i);
      if (!reverse.has(char)) {
        reverse.set(char, i);
      }
    }
  }

  return reverse;
}

// ─── Text region erase ────────────────────────────────────────────────────────

function isTextShowingOperator(op: string): boolean {
  return op === 'Tj' || op === 'TJ' || op === "'" || op === '"';
}

/**
 * Paint a white rectangle over the text run's bounding box before replacing text.
 * Prevents longer edits from visually overlapping adjacent content.
 */
function insertEraseRectForRun(
  instructions: CSInstruction[],
  run: TextRun,
  newText: string,
  hintIndex: number,
): number {
  if (hintIndex < 0 || hintIndex >= instructions.length) return 0;

  let btIndex = hintIndex;
  for (let i = hintIndex; i >= 0; i--) {
    if (instructions[i].operator === 'BT') {
      btIndex = i;
      break;
    }
    if (instructions[i].operator === 'ET') break;
  }

  const fontSize = run.fontSize || run.glyphs[0]?.fontSize || 12;
  const pad = Math.max(2, fontSize * 0.2);
  const oldLen = Math.max(1, run.text.length);
  const widthScale = Math.max(1, newText.length / oldLen);
  const eraseWidth = run.width * widthScale + pad * 2;
  const eraseHeight = (run.height || fontSize) + pad * 2;

  const eraseOps: CSInstruction[] = [
    { operator: 'q', operands: [], offset: 0 },
    { operator: 'rg', operands: [new PDFNumber(1), new PDFNumber(1), new PDFNumber(1)], offset: 0 },
    {
      operator: 're',
      operands: [
        new PDFNumber(run.x - pad),
        new PDFNumber(run.y - pad),
        new PDFNumber(eraseWidth),
        new PDFNumber(eraseHeight),
      ],
      offset: 0,
    },
    { operator: 'f', operands: [], offset: 0 },
    { operator: 'Q', operands: [], offset: 0 },
  ];

  instructions.splice(btIndex, 0, ...eraseOps);
  return eraseOps.length;
}

// ─── Grouped text edit (multi-instruction spans) ────────────────────────────

/**
 * Distribute new text across multiple source instructions proportionally,
 * preserving each instruction's operator (Tj/TJ) and spacing arrays.
 */
function applyGroupedTextEdit(
  instructions: CSInstruction[],
  sourceIndices: number[],
  oldText: string,
  newText: string,
  fontData: FontData | null,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
): void {
  const sortedIndices = Array.from(new Set(sourceIndices)).sort((a, b) => a - b);
  const segments: { index: number; text: string }[] = [];

  for (let i = 0; i < sortedIndices.length; i++) {
    const idx = sortedIndices[i];
    const inst = instructions[idx];
    if (!inst) continue;

    const fontName = findFontNameForInstruction(instructions, idx);
    const decoded = decodeInstructionText(inst, fontName, page, objects);
    if (decoded !== null) {
      segments.push({ index: idx, text: decoded });
    }
  }

  if (segments.length === 0) return;

  const totalOldLen = segments.reduce((sum, s) => sum + s.text.length, 0);
  let newPos = 0;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const inst = instructions[seg.index];
    if (!inst) continue;

    let segNewText: string;
    if (i === segments.length - 1) {
      segNewText = newText.substring(newPos);
    } else if (totalOldLen > 0) {
      const ratio = seg.text.length / totalOldLen;
      const segLen = Math.round(ratio * newText.length);
      segNewText = newText.substring(newPos, newPos + segLen);
      newPos += segLen;
    } else {
      const evenLen = Math.floor(newText.length / segments.length);
      segNewText = newText.substring(newPos, newPos + evenLen);
      newPos += evenLen;
    }

    const encoded = encodeTextForFont(segNewText, fontData);

    if (inst.operator === 'TJ') {
      const oldArr = inst.operands[0];
      if (oldArr instanceof PDFArray) {
        inst.operands = [buildSmartTJArray(oldArr, seg.text, segNewText, encoded.pdfString, fontData)];
      } else {
        inst.operands = [new PDFArray([encoded.pdfString])];
      }
    } else {
      inst.operands = [encoded.pdfString];
    }
  }
}

function findFontNameForInstruction(instructions: CSInstruction[], index: number): string {
  for (let i = index; i >= 0; i--) {
    if (instructions[i].operator === 'Tf') {
      const op = instructions[i].operands[0];
      return op instanceof PDFName ? op.name : '';
    }
  }
  return '';
}

// ─── Smart TJ array building ────────────────────────────────────────────────

/**
 * Build a new TJ array that preserves the spacing pattern from the original.
 * 
 * TJ arrays look like: [(Hello) -80 (World) -120 (!)]
 * The numbers between strings are kerning/spacing adjustments in thousandths
 * of a unit of text space. Destroying these numbers (as the old code did)
 * causes text to render with wrong spacing.
 * 
 * Strategy:
 * - Extract the text fragments and spacing numbers from the old array
 * - If the new text has the same length, apply character-level diff
 * - Otherwise, emit the new text as a single string but inject the average
 *   spacing at word boundaries to maintain readable spacing
 */
function buildSmartTJArray(
  oldArr: PDFArray,
  oldText: string,
  newText: string,
  encodedNewText: PDFObject,
  fontData: FontData | null,
): PDFArray {
  // Collect spacing numbers and their decoded fragment texts
  const fragments: { text: string }[] = [];
  const spacings: number[] = [];

  for (let i = 0; i < oldArr.length; i++) {
    const item = oldArr.get(i)!;
    if (item instanceof PDFNumber) {
      spacings.push(item.value);
    } else if (item instanceof PDFString) {
      fragments.push({ text: item.value });
    } else if (item instanceof PDFHexString) {
      fragments.push({ text: item.hex });
    }
  }

  if (spacings.length === 0 || fragments.length <= 1) {
    return new PDFArray([encodedNewText]);
  }

  // Same-length text: replace fragments in-place, keep all spacing numbers
  if (newText.length === oldText.length && fragments.length === spacings.length + 1) {
    const newItems: PDFObject[] = [];
    let charPos = 0;
    for (let fi = 0; fi < fragments.length; fi++) {
      const fragLen = fragments[fi].text.length;
      const fragText = newText.substring(charPos, charPos + fragLen);
      newItems.push(encodeTextForFont(fragText, fontData).pdfString);
      charPos += fragLen;
      if (fi < spacings.length) {
        newItems.push(new PDFNumber(spacings[fi]));
      }
    }
    return new PDFArray(newItems);
  }

  // Different length: split at word boundaries and distribute spacing proportionally
  const words = newText.split(/(\s+)/);
  if (words.length > 1 && spacings.length > 0) {
    const newItems: PDFObject[] = [];
    const spacingPerGap = spacings.reduce((s, v) => s + v, 0) / spacings.length;
    let wordIdx = 0;

    for (let wi = 0; wi < words.length; wi++) {
      const word = words[wi];
      if (word.length === 0) continue;
      newItems.push(encodeTextForFont(word, fontData).pdfString);
      if (wi < words.length - 1 && wordIdx < spacings.length) {
        // Use original spacing when available, average otherwise
        newItems.push(new PDFNumber(spacings[wordIdx] ?? spacingPerGap));
        wordIdx++;
      }
    }

    if (newItems.length > 0) {
      return new PDFArray(newItems);
    }
  }

  // Last resort: single string (loses justification but avoids orphan spacing)
  return new PDFArray([encodedNewText]);
}

// ─── Instruction compilation ────────────────────────────────────────────────

/**
 * Compile an array of CSInstructions back into content stream bytes.
 */
function compileInstructions(instructions: CSInstruction[]): Uint8Array {
  const parts: string[] = [];

  for (let i = 0; i < instructions.length; i++) {
    const inst = instructions[i];

    // Write operands
    for (const op of inst.operands) {
      parts.push(serializeToString(op));
      parts.push(' ');
    }

    // Write operator
    parts.push(inst.operator);
    parts.push('\n');
  }

  const text = parts.join('');
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    bytes[i] = text.charCodeAt(i) & 0xff;
  }
  return bytes;
}

// ─── Font helpers ───────────────────────────────────────────────────────────

function loadFontForRun(
  run: TextRun,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
): FontData | null {
  return loadFontForName(run.fontName, page, objects);
}

function loadFontForName(
  fontName: string,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
): FontData | null {
  const fontDictRef = page.resources.get('Font');
  if (!fontDictRef) return null;

  const fontDict = resolveRef(fontDictRef, objects);
  if (!(fontDict instanceof PDFDict)) return null;

  const fontRef = fontDict.get(fontName);
  if (!fontRef) return null;

  const fontObj = resolveRef(fontRef, objects);
  if (!(fontObj instanceof PDFDict)) return null;

  return loadFont(fontName, fontObj, objects);
}

// ─── Text search (for find-and-replace) ─────────────────────────────────────

/**
 * Find all occurrences of a search string in a page's text.
 * Returns the TextRuns that contain the search text.
 */
export function findTextInPage(
  contentBytes: Uint8Array,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  searchText: string,
  caseSensitive: boolean = false,
): TextRun[] {
  const interpreted = interpretPage(contentBytes, page, objects);
  const results: TextRun[] = [];

  const search = caseSensitive ? searchText : searchText.toLowerCase();

  for (const run of interpreted.textRuns) {
    const text = caseSensitive ? run.text : run.text.toLowerCase();
    if (text.includes(search)) {
      results.push(run);
    }
  }

  return results;
}

/**
 * Find and replace text in a page's content stream.
 */
export function findAndReplace(
  contentBytes: Uint8Array,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  searchText: string,
  replaceText: string,
  caseSensitive: boolean = false,
): EditResult {
  const matchingRuns = findTextInPage(contentBytes, page, objects, searchText, caseSensitive);

  const edits: TextEdit[] = matchingRuns.map((run) => {
    let newText: string;
    if (caseSensitive) {
      newText = run.text.split(searchText).join(replaceText);
    } else {
      // Case-insensitive replace
      const regex = new RegExp(escapeRegex(searchText), 'gi');
      newText = run.text.replace(regex, replaceText);
    }
    return { targetRun: run, newText };
  });

  return applyTextEdits(contentBytes, page, objects, edits);
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
