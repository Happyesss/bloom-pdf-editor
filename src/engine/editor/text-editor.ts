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
import { interpretPage, type TextRun, type GlyphPosition } from '../content/interpreter';
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

  // Apply each edit
  for (const edit of edits) {
    const matched = matchTextRunToInstruction(
      edit.targetRun,
      textInstructions,
      contentBytes,
      page,
      objects,
    );

    if (!matched) {
      console.warn('[TextEditor] Could not match text run to instruction');
      continue;
    }

    // Load font data for encoding
    const fontData = loadFontForRun(edit.targetRun, page, objects);

    // Encode the new text using the font's encoding
    const encoded = encodeTextForFont(edit.newText, fontData);

    if (encoded.missing.length > 0) {
      needsFontAugmentation = true;
      missingCharCodes.push(...encoded.missing);
    }

    // Replace the operand in the matched instruction
    if (matched.instruction.operator === 'TJ') {
      const arr = new PDFArray([encoded.pdfString]);
      matched.instruction.operands = [arr];
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
}

function findTextInstructions(instructions: CSInstruction[]): TextInstruction[] {
  const result: TextInstruction[] = [];
  let currentFont = '';
  let currentFontSize = 12;
  let lastTfInstruction: CSInstruction | null = null;

  for (let i = 0; i < instructions.length; i++) {
    const inst = instructions[i];

    if (inst.operator === 'Tf') {
      currentFont = inst.operands[0] instanceof PDFName ? inst.operands[0].name : '';
      currentFontSize = inst.operands[1] instanceof PDFNumber ? inst.operands[1].value : 12;
      lastTfInstruction = inst;
    }

    if (inst.operator === 'Tj' || inst.operator === 'TJ' ||
        inst.operator === "'" || inst.operator === '"') {
      result.push({
        instruction: inst,
        index: i,
        fontInstruction: lastTfInstruction,
        fontName: currentFont,
        fontSize: currentFontSize,
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
  // 1) Try exact or trimmed match first
  for (const ti of textInstructions) {
    if (ti.fontName !== run.fontName && run.fontName !== '') continue;

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
      if (ti.fontName !== run.fontName && run.fontName !== '') continue;

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
    if (ti.fontName !== run.fontName && run.fontName !== '') continue;

    const decoded = decodeInstructionText(ti.instruction, ti.fontName, page, objects);
    if (decoded === null) continue;

    if (decoded.includes(run.text) && run.text.trim().length > 1) {
      return ti;
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
