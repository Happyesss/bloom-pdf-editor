/**
 * Content Stream Interpreter
 *
 * Walks the parsed content stream instructions and maintains the full
 * PDF graphics state machine. Produces a display list of positioned
 * text runs, paths, and image references with their exact bounding boxes.
 *
 * This is the heart of the text extraction and layout understanding engine.
 * Every text character that appears on a PDF page is ultimately positioned
 * by this interpreter.
 */

import { parseContentStream, type CSInstruction } from './operator-lexer';
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
} from '../types';
import type { PDFPageInfo } from '../types';
import { resolveRef, getResource } from '../parser/parser';
import { getStandardFont } from '../fonts/standard14';

// ─── Graphics State ─────────────────────────────────────────────────────────

export interface Matrix {
  a: number; b: number;  // | a b 0 |
  c: number; d: number;  // | c d 0 |
  e: number; f: number;  // | e f 1 |
}

function identityMatrix(): Matrix {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}

function multiplyMatrices(m1: Matrix, m2: Matrix): Matrix {
  return {
    a: m1.a * m2.a + m1.b * m2.c,
    b: m1.a * m2.b + m1.b * m2.d,
    c: m1.c * m2.a + m1.d * m2.c,
    d: m1.c * m2.b + m1.d * m2.d,
    e: m1.e * m2.a + m1.f * m2.c + m2.e,
    f: m1.e * m2.b + m1.f * m2.d + m2.f,
  };
}

function transformPoint(m: Matrix, x: number, y: number): [number, number] {
  return [
    m.a * x + m.c * y + m.e,
    m.b * x + m.d * y + m.f,
  ];
}

export interface GraphicsState {
  ctm: Matrix;                  // Current Transformation Matrix
  // Color state
  fillColor: [number, number, number]; // RGB
  strokeColor: [number, number, number];
  fillAlpha: number;
  strokeAlpha: number;
  // Line state
  lineWidth: number;
  lineCap: number;
  lineJoin: number;
  miterLimit: number;
  dashPattern: number[];
  dashPhase: number;
  // Text state
  textFont: string;             // Font resource name (e.g., 'F1')
  textFontSize: number;
  charSpacing: number;
  wordSpacing: number;
  horizontalScaling: number;    // Tz: percentage (default 100)
  textLeading: number;          // TL
  textRenderMode: number;       // Tr
  textRise: number;             // Ts
  // Clipping
  clipPath: PathSegment[] | null;
}

function defaultGraphicsState(): GraphicsState {
  return {
    ctm: identityMatrix(),
    fillColor: [0, 0, 0],
    strokeColor: [0, 0, 0],
    fillAlpha: 1,
    strokeAlpha: 1,
    lineWidth: 1,
    lineCap: 0,
    lineJoin: 0,
    miterLimit: 10,
    dashPattern: [],
    dashPhase: 0,
    textFont: '',
    textFontSize: 12,
    charSpacing: 0,
    wordSpacing: 0,
    horizontalScaling: 100,
    textLeading: 0,
    textRenderMode: 0,
    textRise: 0,
    clipPath: null,
  };
}

function cloneGraphicsState(gs: GraphicsState): GraphicsState {
  return {
    ...gs,
    ctm: { ...gs.ctm },
    fillColor: [...gs.fillColor] as [number, number, number],
    strokeColor: [...gs.strokeColor] as [number, number, number],
    dashPattern: [...gs.dashPattern],
    clipPath: gs.clipPath ? [...gs.clipPath] : null,
  };
}

// ─── Display list items ─────────────────────────────────────────────────────

export interface TextRun {
  type: 'text';
  /** The Unicode text content */
  text: string;
  /** Individual glyph positions */
  glyphs: GlyphPosition[];
  /** Bounding box in page space (PDF coordinates: origin bottom-left) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Font resource name */
  fontName: string;
  fontSize: number;
  /** The full transformation matrix at the time of rendering */
  textMatrix: Matrix;
  /** Color */
  fillColor: [number, number, number];
  fillAlpha: number;
}

export interface GlyphPosition {
  /** Character code as stored in the PDF */
  charCode: number;
  /** Unicode string for this glyph */
  unicode: string;
  /** X position in page space */
  x: number;
  /** Y position in page space */
  y: number;
  /** Advance width in page space */
  width: number;
  /** Font size in page space */
  fontSize: number;
  /** Width of the glyph in Text Space (w0/1000) */
  textSpaceWidth: number;
  /** Text Rendering Matrix (T_rm) which exactly places and scales the glyph in User Space */
  tRm: { a: number; b: number; c: number; d: number; e: number; f: number };
}

export interface PathSegment {
  type: 'M' | 'L' | 'C' | 'Z'; // moveTo, lineTo, curveTo, closePath
  points: number[]; // [x,y] for M/L, [x1,y1,x2,y2,x3,y3] for C
}

export interface PathItem {
  type: 'path';
  segments: PathSegment[];
  strokeColor: [number, number, number] | null;
  fillColor: [number, number, number] | null;
  strokeAlpha: number;
  fillAlpha: number;
  lineWidth: number;
  paintType: 'stroke' | 'fill' | 'both' | 'none';
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageItem {
  type: 'image';
  /** Resource name from /Do operator */
  name: string;
  /** Transform matrix positioning the image */
  ctm: Matrix;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type DisplayItem = TextRun | PathItem | ImageItem;

// ─── Font info cache ────────────────────────────────────────────────────────

export interface FontInfo {
  name: string;
  baseFont: string;
  subtype: string; // Type1, TrueType, Type0, CIDFontType2, etc.
  encoding: string;
  isComposite: boolean;
  /** Maps char code → Unicode string */
  toUnicode: Map<number, string> | null;
  /** Glyph widths: code → width in 1/1000 units of font size */
  widths: Map<number, number>;
  /** Default width for missing entries */
  defaultWidth: number;
  /** First char code with a width entry */
  firstChar: number;
  /** Last char code with a width entry */
  lastChar: number;
}

// ─── Interpreter ────────────────────────────────────────────────────────────

export interface InterpreterResult {
  displayList: DisplayItem[];
  textRuns: TextRun[];
  fonts: Map<string, FontInfo>;
}

/**
 * Interpret a page's content streams and produce a display list.
 *
 * @param contentBytes Decoded content stream bytes (concatenated if multiple)
 * @param page Page info for dimensions and resources
 * @param objects Full document object map for resolving references
 */
export function interpretPage(
  contentBytes: Uint8Array,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
): InterpreterResult {
  const instructions = parseContentStream(contentBytes);
  const displayList: DisplayItem[] = [];
  const textRuns: TextRun[] = [];
  const fonts = new Map<string, FontInfo>();

  // State machine
  let gs = defaultGraphicsState();
  const gsStack: GraphicsState[] = [];

  // Text state
  let textMatrix = identityMatrix();     // Tm: text matrix
  let textLineMatrix = identityMatrix(); // For T* and TD tracking
  let inTextBlock = false;

  // Path construction
  let currentPath: PathSegment[] = [];
  let pathStartX = 0;
  let pathStartY = 0;

  // Pre-load fonts from resources
  loadFonts(page.resources, objects, fonts);

  function num(obj: PDFObject | undefined): number {
    return obj instanceof PDFNumber ? obj.value : 0;
  }

  function nameStr(obj: PDFObject | undefined): string {
    return obj instanceof PDFName ? obj.name : '';
  }

  for (let i = 0; i < instructions.length; i++) {
    const inst = instructions[i];
    const ops = inst.operands;

    switch (inst.operator) {
      // ── Graphics state ──────────────────────────────────────────────
      case 'q':
        gsStack.push(cloneGraphicsState(gs));
        break;

      case 'Q':
        if (gsStack.length > 0) gs = gsStack.pop()!;
        break;

      case 'cm': {
        // Concatenate matrix: a b c d e f cm
        const m: Matrix = {
          a: num(ops[0]), b: num(ops[1]),
          c: num(ops[2]), d: num(ops[3]),
          e: num(ops[4]), f: num(ops[5]),
        };
        gs.ctm = multiplyMatrices(m, gs.ctm);
        break;
      }

      case 'w':
        gs.lineWidth = num(ops[0]);
        break;

      case 'J':
        gs.lineCap = num(ops[0]);
        break;

      case 'j':
        gs.lineJoin = num(ops[0]);
        break;

      case 'M':
        gs.miterLimit = num(ops[0]);
        break;

      case 'd': {
        // Dash pattern: [array] phase d
        const arr = ops[0] instanceof PDFArray ? ops[0].asNumbers() : [];
        gs.dashPattern = arr;
        gs.dashPhase = num(ops[1]);
        break;
      }

      case 'gs': {
        // Extended graphics state from resource dictionary
        const gsName = nameStr(ops[0]);
        const gsDict = getResource(page.resources, 'ExtGState', gsName, objects);
        if (gsDict instanceof PDFDict) {
          applyExtGState(gsDict, gs, objects);
        }
        break;
      }

      // ── Color operators ─────────────────────────────────────────────
      case 'g':
        gs.fillColor = [num(ops[0]), num(ops[0]), num(ops[0])];
        break;

      case 'G':
        gs.strokeColor = [num(ops[0]), num(ops[0]), num(ops[0])];
        break;

      case 'rg':
        gs.fillColor = [num(ops[0]), num(ops[1]), num(ops[2])];
        break;

      case 'RG':
        gs.strokeColor = [num(ops[0]), num(ops[1]), num(ops[2])];
        break;

      case 'k': {
        // CMYK fill → approximate RGB
        const [c, m, y, k] = [num(ops[0]), num(ops[1]), num(ops[2]), num(ops[3])];
        gs.fillColor = cmykToRgb(c, m, y, k);
        break;
      }

      case 'K': {
        const [c, m, y, k] = [num(ops[0]), num(ops[1]), num(ops[2]), num(ops[3])];
        gs.strokeColor = cmykToRgb(c, m, y, k);
        break;
      }

      case 'sc':
      case 'scn':
        // Set fill color (generic — assume RGB if 3 operands, gray if 1)
        if (ops.length >= 3) gs.fillColor = [num(ops[0]), num(ops[1]), num(ops[2])];
        else if (ops.length >= 1) gs.fillColor = [num(ops[0]), num(ops[0]), num(ops[0])];
        break;

      case 'SC':
      case 'SCN':
        if (ops.length >= 3) gs.strokeColor = [num(ops[0]), num(ops[1]), num(ops[2])];
        else if (ops.length >= 1) gs.strokeColor = [num(ops[0]), num(ops[0]), num(ops[0])];
        break;

      // ── Text state ──────────────────────────────────────────────────
      case 'Tc':
        gs.charSpacing = num(ops[0]);
        break;

      case 'Tw':
        gs.wordSpacing = num(ops[0]);
        break;

      case 'Tz':
        gs.horizontalScaling = num(ops[0]);
        break;

      case 'TL':
        gs.textLeading = num(ops[0]);
        break;

      case 'Tf':
        gs.textFont = nameStr(ops[0]);
        gs.textFontSize = num(ops[1]);
        break;

      case 'Tr':
        gs.textRenderMode = num(ops[0]);
        break;

      case 'Ts':
        gs.textRise = num(ops[0]);
        break;

      // ── Text blocks ─────────────────────────────────────────────────
      case 'BT':
        inTextBlock = true;
        textMatrix = identityMatrix();
        textLineMatrix = identityMatrix();
        break;

      case 'ET':
        inTextBlock = false;
        break;

      // ── Text positioning ────────────────────────────────────────────
      case 'Td': {
        // Move text position: tx ty Td
        const tx = num(ops[0]);
        const ty = num(ops[1]);
        const m: Matrix = { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
        textLineMatrix = multiplyMatrices(m, textLineMatrix);
        textMatrix = { ...textLineMatrix };
        break;
      }

      case 'TD': {
        // Same as Td but also sets TL = -ty
        const tx = num(ops[0]);
        const ty = num(ops[1]);
        gs.textLeading = -ty;
        const m: Matrix = { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
        textLineMatrix = multiplyMatrices(m, textLineMatrix);
        textMatrix = { ...textLineMatrix };
        break;
      }

      case 'Tm': {
        // Set text matrix directly: a b c d e f Tm
        textMatrix = {
          a: num(ops[0]), b: num(ops[1]),
          c: num(ops[2]), d: num(ops[3]),
          e: num(ops[4]), f: num(ops[5]),
        };
        textLineMatrix = { ...textMatrix };
        break;
      }

      case 'T*': {
        // Move to start of next line (equivalent to 0 -TL Td)
        const m: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: -gs.textLeading };
        textLineMatrix = multiplyMatrices(m, textLineMatrix);
        textMatrix = { ...textLineMatrix };
        break;
      }

      // ── Text showing ────────────────────────────────────────────────
      case 'Tj': {
        // Show a text string
        const strObj = ops[0];
        if (strObj) {
          const result = showTextString(strObj, gs, textMatrix, fonts, objects, page);
          if (result) {
            displayList.push(result.run);
            textRuns.push(result.run);
            textMatrix = result.newTextMatrix;
          }
        }
        break;
      }

      case 'TJ': {
        // Show text with individual glyph positioning
        // Operand is an array of strings and numbers
        const arr = ops[0];
        if (arr instanceof PDFArray) {
          const combinedGlyphs: GlyphPosition[] = [];
          let combinedText = '';
          let firstRun: TextRun | null = null;
          let lastRun: TextRun | null = null;

          for (let j = 0; j < arr.length; j++) {
            const item = arr.get(j)!;
            if (item instanceof PDFNumber) {
              // Negative number = move right, positive = move left (in thousandths of text space unit)
              const displacement = -item.value / 1000 * gs.textFontSize * (gs.horizontalScaling / 100);
              textMatrix = {
                ...textMatrix,
                e: textMatrix.e + displacement * textMatrix.a,
                f: textMatrix.f + displacement * textMatrix.b,
              };
            } else {
              const result = showTextString(item, gs, textMatrix, fonts, objects, page);
              if (result) {
                if (!firstRun) firstRun = result.run;
                lastRun = result.run;
                combinedGlyphs.push(...result.run.glyphs);
                combinedText += result.run.text;
                textMatrix = result.newTextMatrix;
              }
            }
          }

          if (firstRun && lastRun && combinedGlyphs.length > 0) {
            let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
            for (let k = 0; k < combinedGlyphs.length; k++) {
              const g = combinedGlyphs[k];
              if (g.x < minX) minX = g.x;
              if (g.y < minY) minY = g.y;
              if (g.x + g.width > maxX) maxX = g.x + g.width;
              if (g.y + g.fontSize > maxY) maxY = g.y + g.fontSize;
            }
            const combinedRun: TextRun = {
              ...firstRun,
              text: combinedText,
              glyphs: combinedGlyphs,
              x: minX,
              y: minY,
              width: maxX - minX,
              height: maxY - minY,
            };
            displayList.push(combinedRun);
            textRuns.push(combinedRun);
          }
        }
        break;
      }

      case "'": {
        // Move to next line and show text: equivalent to T* then Tj
        const m: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: -gs.textLeading };
        textLineMatrix = multiplyMatrices(m, textLineMatrix);
        textMatrix = { ...textLineMatrix };
        const strObj = ops[0];
        if (strObj) {
          const result = showTextString(strObj, gs, textMatrix, fonts, objects, page);
          if (result) {
            displayList.push(result.run);
            textRuns.push(result.run);
            textMatrix = result.newTextMatrix;
          }
        }
        break;
      }

      case '"': {
        // Set word/char spacing, move to next line, show text
        gs.wordSpacing = num(ops[0]);
        gs.charSpacing = num(ops[1]);
        const m: Matrix = { a: 1, b: 0, c: 0, d: 1, e: 0, f: -gs.textLeading };
        textLineMatrix = multiplyMatrices(m, textLineMatrix);
        textMatrix = { ...textLineMatrix };
        const strObj = ops[2];
        if (strObj) {
          const result = showTextString(strObj, gs, textMatrix, fonts, objects, page);
          if (result) {
            displayList.push(result.run);
            textRuns.push(result.run);
            textMatrix = result.newTextMatrix;
          }
        }
        break;
      }

      // ── Path construction ───────────────────────────────────────────
      case 'm': {
        const [x, y] = transformPoint(gs.ctm, num(ops[0]), num(ops[1]));
        currentPath.push({ type: 'M', points: [x, y] });
        pathStartX = x;
        pathStartY = y;
        break;
      }

      case 'l': {
        const [x, y] = transformPoint(gs.ctm, num(ops[0]), num(ops[1]));
        currentPath.push({ type: 'L', points: [x, y] });
        break;
      }

      case 'c': {
        const [x1, y1] = transformPoint(gs.ctm, num(ops[0]), num(ops[1]));
        const [x2, y2] = transformPoint(gs.ctm, num(ops[2]), num(ops[3]));
        const [x3, y3] = transformPoint(gs.ctm, num(ops[4]), num(ops[5]));
        currentPath.push({ type: 'C', points: [x1, y1, x2, y2, x3, y3] });
        break;
      }

      case 'v': {
        // Current point as first control point
        const lastSeg = currentPath[currentPath.length - 1];
        const cx = lastSeg ? lastSeg.points[lastSeg.points.length - 2] : 0;
        const cy = lastSeg ? lastSeg.points[lastSeg.points.length - 1] : 0;
        const [x2, y2] = transformPoint(gs.ctm, num(ops[0]), num(ops[1]));
        const [x3, y3] = transformPoint(gs.ctm, num(ops[2]), num(ops[3]));
        currentPath.push({ type: 'C', points: [cx, cy, x2, y2, x3, y3] });
        break;
      }

      case 'y': {
        // End point as second control point
        const [x1, y1] = transformPoint(gs.ctm, num(ops[0]), num(ops[1]));
        const [x3, y3] = transformPoint(gs.ctm, num(ops[2]), num(ops[3]));
        currentPath.push({ type: 'C', points: [x1, y1, x3, y3, x3, y3] });
        break;
      }

      case 'h':
        currentPath.push({ type: 'Z', points: [] });
        break;

      case 're': {
        // Rectangle: x y width height re
        const rx = num(ops[0]);
        const ry = num(ops[1]);
        const rw = num(ops[2]);
        const rh = num(ops[3]);
        const [p1x, p1y] = transformPoint(gs.ctm, rx, ry);
        const [p2x, p2y] = transformPoint(gs.ctm, rx + rw, ry);
        const [p3x, p3y] = transformPoint(gs.ctm, rx + rw, ry + rh);
        const [p4x, p4y] = transformPoint(gs.ctm, rx, ry + rh);
        currentPath.push({ type: 'M', points: [p1x, p1y] });
        currentPath.push({ type: 'L', points: [p2x, p2y] });
        currentPath.push({ type: 'L', points: [p3x, p3y] });
        currentPath.push({ type: 'L', points: [p4x, p4y] });
        currentPath.push({ type: 'Z', points: [] });
        break;
      }

      // ── Path painting ───────────────────────────────────────────────
      case 'S': emitPath('stroke'); break;
      case 's': { currentPath.push({ type: 'Z', points: [] }); emitPath('stroke'); break; }
      case 'f': case 'F': emitPath('fill'); break;
      case 'f*': emitPath('fill'); break;
      case 'B': emitPath('both'); break;
      case 'B*': emitPath('both'); break;
      case 'b': { currentPath.push({ type: 'Z', points: [] }); emitPath('both'); break; }
      case 'b*': { currentPath.push({ type: 'Z', points: [] }); emitPath('both'); break; }
      case 'n': { currentPath = []; break; } // Discard path

      // ── XObjects ────────────────────────────────────────────────────
      case 'Do': {
        const xobjName = nameStr(ops[0]);
        if (xobjName) {
          const xobj = getResource(page.resources, 'XObject', xobjName, objects);
          if (xobj instanceof PDFStream) {
            const subtype = xobj.dict.getName('Subtype');
            if (subtype === 'Image') {
              const imgW = xobj.dict.getNumber('Width') ?? 1;
              const imgH = xobj.dict.getNumber('Height') ?? 1;
              const [x, y] = transformPoint(gs.ctm, 0, 0);
              const [x2, y2] = transformPoint(gs.ctm, 1, 1);
              displayList.push({
                type: 'image',
                name: xobjName,
                ctm: { ...gs.ctm },
                x: Math.min(x, x2),
                y: Math.min(y, y2),
                width: Math.abs(x2 - x),
                height: Math.abs(y2 - y),
              });
            }
            // Form XObjects would be recursively interpreted here
          }
        }
        break;
      }

      // ── Marked content (skip) ───────────────────────────────────────
      case 'BMC': case 'BDC': case 'EMC':
      case 'MP': case 'DP':
        break;

      // ── Compatibility (skip) ────────────────────────────────────────
      case 'BX': case 'EX':
        break;

      default:
        break;
    }
  }

  function emitPath(paintType: 'stroke' | 'fill' | 'both' | 'none') {
    if (currentPath.length === 0) return;

    const bounds = computePathBounds(currentPath);
    displayList.push({
      type: 'path',
      segments: [...currentPath],
      strokeColor: paintType === 'fill' ? null : [...gs.strokeColor] as [number, number, number],
      fillColor: paintType === 'stroke' ? null : [...gs.fillColor] as [number, number, number],
      strokeAlpha: gs.strokeAlpha,
      fillAlpha: gs.fillAlpha,
      lineWidth: gs.lineWidth,
      paintType,
      ...bounds,
    });
    currentPath = [];
  }

  return { displayList, textRuns, fonts };
}

// ─── Text rendering helpers ─────────────────────────────────────────────────

interface ShowTextResult {
  run: TextRun;
  newTextMatrix: Matrix;
}

function showTextString(
  strObj: PDFObject,
  gs: GraphicsState,
  textMatrix: Matrix,
  fonts: Map<string, FontInfo>,
  objects: Map<string, PDFObject>,
  page: PDFPageInfo,
): ShowTextResult | null {
  const font = fonts.get(gs.textFont);

  // Extract raw bytes from string
  let rawBytes: Uint8Array;
  if (strObj instanceof PDFString) {
    rawBytes = strObj.toBytes();
  } else if (strObj instanceof PDFHexString) {
    rawBytes = strObj.toBytes();
  } else {
    return null;
  }

  if (rawBytes.length === 0) return null;

  const glyphs: GlyphPosition[] = [];
  let text = '';
  let totalWidth = 0;
  const fontSize = gs.textFontSize;
  const hScale = gs.horizontalScaling / 100;

  const isComposite = font?.isComposite ?? false;
  let idx = 0;

  while (idx < rawBytes.length) {
    let charCode: number;

    if (isComposite) {
      // Composite fonts use 2-byte character codes
      if (idx + 1 < rawBytes.length) {
        charCode = (rawBytes[idx] << 8) | rawBytes[idx + 1];
        idx += 2;
      } else {
        charCode = rawBytes[idx];
        idx += 1;
      }
    } else {
      charCode = rawBytes[idx];
      idx += 1;
    }

    // Map to Unicode
    let unicode: string;
    if (font?.toUnicode?.has(charCode)) {
      unicode = font.toUnicode.get(charCode)!;
    } else if (!isComposite && charCode >= 0x20 && charCode <= 0x7e) {
      unicode = String.fromCharCode(charCode);
    } else if (!isComposite) {
      // Try standard encoding
      unicode = String.fromCharCode(charCode);
    } else {
      unicode = String.fromCharCode(charCode);
    }

    // Get glyph width (in 1/1000 units of font size)
    let glyphWidth1000 = font?.widths.get(charCode);
    if (glyphWidth1000 === undefined && unicode && font?.widths) {
      // If widths were populated from TTF cmap, they are keyed by Unicode, not charCode/CID
      const unicodeCodePoint = unicode.charCodeAt(0);
      glyphWidth1000 = font.widths.get(unicodeCodePoint);
    }
    glyphWidth1000 = glyphWidth1000 ?? font?.defaultWidth ?? 600;

    const glyphWidth = (glyphWidth1000 / 1000) * fontSize * hScale;

    // Compute Trm: T_state * Tm * CTM
    // T_state = [fontSize * hScale, 0, 0, fontSize, 0, textRise]
    const tState: Matrix = {
      a: fontSize * hScale, b: 0,
      c: 0, d: fontSize,
      e: 0, f: gs.textRise,
    };
    const tRm = multiplyMatrices(multiplyMatrices(tState, textMatrix), gs.ctm);

    glyphs.push({
      charCode,
      unicode,
      x: tRm.e,
      y: tRm.f,
      width: (glyphWidth1000 / 1000) * Math.abs(tRm.a || tRm.d),
      fontSize: Math.abs(tRm.d || tRm.a),
      textSpaceWidth: glyphWidth1000 / 1000,
      tRm,
    });

    text += unicode;

    // Advance text position
    let advance = (glyphWidth1000 / 1000) * fontSize + gs.charSpacing;
    if (unicode === ' ') advance += gs.wordSpacing;
    advance *= hScale;

    totalWidth += advance;

    // Update text matrix for next glyph
    textMatrix = {
      ...textMatrix,
      e: textMatrix.e + advance * textMatrix.a,
      f: textMatrix.f + advance * textMatrix.b,
    };
  }

  if (glyphs.length === 0) return null;

  // Compute bounding box
  const effectiveMatrix = multiplyMatrices(textMatrix, gs.ctm);
  const startX = glyphs[0].x;
  const startY = glyphs[0].y;
  const endGlyph = glyphs[glyphs.length - 1];
  const runWidth = (endGlyph.x + endGlyph.width) - startX;
  const runHeight = fontSize * Math.abs(effectiveMatrix.d || effectiveMatrix.a || 1);

  return {
    run: {
      type: 'text',
      text,
      glyphs,
      x: startX,
      y: startY,
      width: Math.abs(runWidth) || totalWidth,
      height: runHeight,
      fontName: gs.textFont,
      fontSize,
      textMatrix: { ...effectiveMatrix },
      fillColor: [...gs.fillColor] as [number, number, number],
      fillAlpha: gs.fillAlpha,
    },
    newTextMatrix: textMatrix,
  };
}

// advanceTextMatrix removed — text matrix is now returned from showTextString

// ─── Font loading ───────────────────────────────────────────────────────────

function loadFonts(
  resources: PDFDict,
  objects: Map<string, PDFObject>,
  fonts: Map<string, FontInfo>,
): void {
  const fontDict = resources.get('Font');
  if (!fontDict) return;

  const resolved = resolveRef(fontDict, objects);
  if (!(resolved instanceof PDFDict)) return;

  const entries = Array.from(resolved.entries());
  for (let i = 0; i < entries.length; i++) {
    const [name, ref] = entries[i];
    const fontObj = resolveRef(ref, objects);
    if (!(fontObj instanceof PDFDict)) continue;

    const info = parseFontDict(name, fontObj, objects);
    fonts.set(name, info);
  }
}

function parseFontDict(
  name: string,
  dict: PDFDict,
  objects: Map<string, PDFObject>,
): FontInfo {
  const subtype = dict.getName('Subtype') ?? 'Type1';
  const baseFont = dict.getName('BaseFont') ?? '';
  const isComposite = subtype === 'Type0';

  // Parse widths
  const widths = new Map<number, number>();
  let defaultWidth = 1000;
  let firstChar = 0;
  let lastChar = 255;

  if (isComposite) {
    // Type0 font — look at descendant CIDFont
    const descFonts = dict.getArray('DescendantFonts');
    if (descFonts && descFonts.length > 0) {
      const cidFontRef = descFonts.get(0)!;
      const cidFont = resolveRef(cidFontRef, objects);
      if (cidFont instanceof PDFDict) {
        defaultWidth = cidFont.getNumber('DW') ?? 1000;

        // Parse W array: [cid [w1 w2 ...]] or [cidFirst cidLast w]
        const wArray = cidFont.get('W');
        const resolvedW = wArray ? resolveRef(wArray, objects) : undefined;
        if (resolvedW instanceof PDFArray) {
          parseCIDWidths(resolvedW, widths);
        }
      }
    }
  } else {
    // Simple font
    firstChar = dict.getNumber('FirstChar') ?? 0;
    lastChar = dict.getNumber('LastChar') ?? 255;
    const widthsArray = dict.get('Widths');
    const resolvedWidths = widthsArray ? resolveRef(widthsArray, objects) : undefined;
    if (resolvedWidths instanceof PDFArray) {
      const nums = resolvedWidths.asNumbers();
      for (let i = 0; i < nums.length; i++) {
        if (!isNaN(nums[i])) {
          widths.set(firstChar + i, nums[i]);
        }
      }
    }

    // If no explicit widths, check standard 14 font metrics
    if (widths.size === 0) {
      const stdMetrics = getStandardFont(baseFont);
      if (stdMetrics) {
        for (let i = 0; i < 256; i++) {
          widths.set(i, stdMetrics.widths[i]);
        }
        defaultWidth = stdMetrics.defaultWidth;
      } else {
        defaultWidth = 600; // Reasonable fallback
      }
    } else {
      defaultWidth = 600;
    }
  }

  // Parse ToUnicode CMap
  let toUnicode: Map<number, string> | null = null;
  const toUnicodeRef = dict.get('ToUnicode');
  if (toUnicodeRef) {
    const toUnicodeObj = resolveRef(toUnicodeRef, objects);
    if (toUnicodeObj instanceof PDFStream) {
      toUnicode = parseToUnicodeCMap(toUnicodeObj.getBytes());
    }
  }

  // Parse encoding for simple fonts
  let encoding = 'StandardEncoding';
  const encodingObj = dict.get('Encoding');
  if (encodingObj) {
    const resolved = resolveRef(encodingObj, objects);
    if (resolved instanceof PDFName) {
      encoding = resolved.name;
    } else if (resolved instanceof PDFDict) {
      encoding = resolved.getName('BaseEncoding') ?? 'StandardEncoding';
      // Could also parse /Differences array here for custom encoding
    }
  }

  return {
    name,
    baseFont,
    subtype,
    encoding,
    isComposite,
    toUnicode,
    widths,
    defaultWidth,
    firstChar,
    lastChar,
  };
}

/**
 * Parse CID font width array (W entry).
 * Format alternates between:
 *   cidFirst [w1 w2 w3 ...] — consecutive widths starting at cidFirst
 *   cidFirst cidLast w       — same width for range
 */
function parseCIDWidths(wArray: PDFArray, widths: Map<number, number>): void {
  let i = 0;
  while (i < wArray.length) {
    const first = wArray.get(i);
    if (!(first instanceof PDFNumber)) { i++; continue; }

    const second = wArray.get(i + 1);
    if (second instanceof PDFArray) {
      // cidFirst [w1 w2 ...]
      const cid = first.value;
      const ws = second.asNumbers();
      for (let j = 0; j < ws.length; j++) {
        if (!isNaN(ws[j])) widths.set(cid + j, ws[j]);
      }
      i += 2;
    } else if (second instanceof PDFNumber) {
      // cidFirst cidLast w
      const cidFirst = first.value;
      const cidLast = second.value;
      const w = wArray.get(i + 2);
      const width = w instanceof PDFNumber ? w.value : 1000;
      for (let cid = cidFirst; cid <= cidLast; cid++) {
        widths.set(cid, width);
      }
      i += 3;
    } else {
      i++;
    }
  }
}

// ─── ToUnicode CMap parser ──────────────────────────────────────────────────

/**
 * Parse a ToUnicode CMap stream to build a charCode → Unicode mapping.
 * Handles beginbfchar and beginbfrange sections.
 */
function parseToUnicodeCMap(data: Uint8Array): Map<number, string> {
  const map = new Map<number, string>();
  const text = new TextDecoder('latin1').decode(data);

  // Parse beginbfchar ... endbfchar
  const bfcharRegex = /beginbfchar\s*([\s\S]*?)endbfchar/g;
  let match: RegExpExecArray | null;

  while ((match = bfcharRegex.exec(text)) !== null) {
    const block = match[1];
    const lineRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRegex.exec(block)) !== null) {
      const charCode = parseInt(lineMatch[1], 16);
      const unicode = hexToUnicodeString(lineMatch[2]);
      map.set(charCode, unicode);
    }
  }

  // Parse beginbfrange ... endbfrange
  const bfrangeRegex = /beginbfrange\s*([\s\S]*?)endbfrange/g;

  while ((match = bfrangeRegex.exec(text)) !== null) {
    const block = match[1];
    // Two formats:
    // <start> <end> <unicodeStart>
    // <start> <end> [<u1> <u2> ...]
    const rangeRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([\s\S]*?)\])/g;
    let rangeMatch: RegExpExecArray | null;

    while ((rangeMatch = rangeRegex.exec(block)) !== null) {
      const startCode = parseInt(rangeMatch[1], 16);
      const endCode = parseInt(rangeMatch[2], 16);

      if (rangeMatch[3]) {
        // <start> <end> <unicodeStart> — sequential mapping
        let unicodeStart = parseInt(rangeMatch[3], 16);
        for (let code = startCode; code <= endCode; code++) {
          map.set(code, String.fromCodePoint(unicodeStart++));
        }
      } else if (rangeMatch[4]) {
        // <start> <end> [<u1> <u2> ...] — explicit array
        const arrayContent = rangeMatch[4];
        const hexValues = arrayContent.match(/<([0-9a-fA-F]+)>/g) ?? [];
        for (let j = 0; j < hexValues.length && startCode + j <= endCode; j++) {
          const hex = hexValues[j].replace(/[<>]/g, '');
          map.set(startCode + j, hexToUnicodeString(hex));
        }
      }
    }
  }

  return map;
}

function hexToUnicodeString(hex: string): string {
  let result = '';
  // Each pair of 4 hex digits is a Unicode code point
  for (let i = 0; i < hex.length; i += 4) {
    if (i + 4 <= hex.length) {
      result += String.fromCodePoint(parseInt(hex.substring(i, i + 4), 16));
    } else {
      // Remaining 2 digits — single byte
      result += String.fromCodePoint(parseInt(hex.substring(i), 16));
    }
  }
  return result;
}

// ─── Extended Graphics State ────────────────────────────────────────────────

function applyExtGState(
  dict: PDFDict,
  gs: GraphicsState,
  objects: Map<string, PDFObject>,
): void {
  const ca = dict.getNumber('ca');  // Fill alpha
  if (ca !== undefined) gs.fillAlpha = ca;

  const CA = dict.getNumber('CA');  // Stroke alpha
  if (CA !== undefined) gs.strokeAlpha = CA;

  const LW = dict.getNumber('LW');
  if (LW !== undefined) gs.lineWidth = LW;

  const LC = dict.getNumber('LC');
  if (LC !== undefined) gs.lineCap = LC;

  const LJ = dict.getNumber('LJ');
  if (LJ !== undefined) gs.lineJoin = LJ;

  const ML = dict.getNumber('ML');
  if (ML !== undefined) gs.miterLimit = ML;

  // Font from ExtGState
  const fontArr = dict.getArray('Font');
  if (fontArr && fontArr.length >= 2) {
    const fontName = fontArr.get(0);
    const fontSize = fontArr.get(1);
    if (fontName instanceof PDFName) gs.textFont = fontName.name;
    if (fontSize instanceof PDFNumber) gs.textFontSize = fontSize.value;
  }
}

// ─── Path bounds computation ────────────────────────────────────────────────

function computePathBounds(segments: PathSegment[]): {
  x: number; y: number; width: number; height: number;
} {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const seg of segments) {
    for (let i = 0; i < seg.points.length; i += 2) {
      const x = seg.points[i];
      const y = seg.points[i + 1];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }

  if (!isFinite(minX)) return { x: 0, y: 0, width: 0, height: 0 };

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

// ─── Color conversion ───────────────────────────────────────────────────────

function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  return [
    (1 - c) * (1 - k),
    (1 - m) * (1 - k),
    (1 - y) * (1 - k),
  ];
}
