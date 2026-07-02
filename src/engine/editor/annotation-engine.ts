/**
 * Annotation Engine
 *
 * Creates and manages PDF annotation objects. Unlike canvas overlays,
 * these are real PDF annotations stored in the document structure.
 *
 * Supports:
 *   - Text markup: Highlight, Underline, StrikeOut, Squiggly
 *   - FreeText: Arbitrary text at any position
 *   - Ink: Freehand drawing (e.g., signatures)
 *   - Stamp: Predefined or custom stamps
 *   - Redaction: Marks areas for content removal
 *   - Link: Hyperlinks to URLs or page destinations
 *
 * Each annotation creates:
 *   1. An annotation dictionary in the page's /Annots array
 *   2. An appearance stream (/AP) so the annotation renders correctly
 *      in any viewer without rebuilding appearances
 */

import {
  PDFArray,
  PDFBoolean,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFRectangle,
} from '../types';
import { flateEncode } from '../parser/filters';

// ─── Annotation types ───────────────────────────────────────────────────────

export interface AnnotationBase {
  /** Bounding rectangle in PDF coordinates [x1, y1, x2, y2] */
  rect: PDFRectangle;
  /** Annotation color as RGB (0-1) */
  color: [number, number, number];
  /** Opacity (0-1) */
  opacity: number;
  /** Author/title */
  author?: string;
  /** Contents/description */
  contents?: string;
  /** Modification date */
  modDate?: string;
}

export interface HighlightAnnotation extends AnnotationBase {
  type: 'Highlight' | 'Underline' | 'StrikeOut' | 'Squiggly';
  /** QuadPoints: array of [x1,y1,...,x4,y4] defining the text region */
  quadPoints: number[];
}

export interface FreeTextAnnotation extends AnnotationBase {
  type: 'FreeText';
  /** The text to display */
  text: string;
  /** Font size in points */
  fontSize: number;
  /** Font name (CSS family name) */
  fontName: string;
  /** Text color */
  textColor: [number, number, number];
  /** Border width (0 for none) */
  borderWidth: number;
}

export interface InkAnnotation extends AnnotationBase {
  type: 'Ink';
  /** Array of ink paths. Each path is [x1,y1, x2,y2, ...] */
  inkPaths: number[][];
  /** Stroke width */
  lineWidth: number;
}

export interface StampAnnotation extends AnnotationBase {
  type: 'Stamp';
  /** Stamp name: Approved, NotApproved, Draft, etc. */
  stampName: string;
}

export interface RedactAnnotation extends AnnotationBase {
  type: 'Redact';
  /** QuadPoints defining the text region to redact */
  quadPoints: number[];
  /** Overlay text (shown after redaction is applied) */
  overlayText?: string;
}

export interface LinkAnnotation extends AnnotationBase {
  type: 'Link';
  /** URL to link to */
  url?: string;
  /** Destination page index (for internal links) */
  destPage?: number;
}

export type Annotation =
  | HighlightAnnotation
  | FreeTextAnnotation
  | InkAnnotation
  | StampAnnotation
  | RedactAnnotation
  | LinkAnnotation;

// ─── Annotation creation ────────────────────────────────────────────────────

/**
 * Create a PDF annotation dictionary from our annotation specification.
 * Returns the dictionary ready to be added to a page's /Annots array.
 */
export function createAnnotationDict(
  annotation: Annotation,
  nextObjNum: number,
): { dict: PDFDict; appearanceStream: PDFStream | null } {
  const dict = new PDFDict();

  // Common entries
  dict.set('Type', new PDFName('Annot'));
  dict.set('Rect', rectToArray(annotation.rect));
  dict.set('C', new PDFArray([
    new PDFNumber(annotation.color[0]),
    new PDFNumber(annotation.color[1]),
    new PDFNumber(annotation.color[2]),
  ]));

  if (annotation.opacity < 1) {
    dict.set('CA', new PDFNumber(annotation.opacity));
  }

  if (annotation.author) {
    dict.set('T', new PDFString(annotation.author));
  }
  if (annotation.contents) {
    dict.set('Contents', new PDFString(annotation.contents));
  }
  if (annotation.modDate) {
    dict.set('M', new PDFString(annotation.modDate));
  }

  // Flag: Print (bit 3)
  dict.set('F', new PDFNumber(4));

  let appearanceStream: PDFStream | null = null;

  switch (annotation.type) {
    case 'Highlight':
    case 'Underline':
    case 'StrikeOut':
    case 'Squiggly':
      dict.set('Subtype', new PDFName(annotation.type));
      dict.set('QuadPoints', new PDFArray(
        annotation.quadPoints.map((n) => new PDFNumber(n)),
      ));
      appearanceStream = buildHighlightAppearance(annotation);
      break;

    case 'FreeText':
      dict.set('Subtype', new PDFName('FreeText'));
      dict.set('DA', new PDFString(
        `/${annotation.fontName} ${annotation.fontSize} Tf ` +
        `${annotation.textColor[0]} ${annotation.textColor[1]} ${annotation.textColor[2]} rg`,
      ));
      dict.set('Contents', new PDFString(annotation.text));
      if (annotation.borderWidth > 0) {
        dict.set('BS', buildBorderStyle(annotation.borderWidth));
      }
      appearanceStream = buildFreeTextAppearance(annotation);
      break;

    case 'Ink':
      dict.set('Subtype', new PDFName('Ink'));
      const inkLists = new PDFArray(
        annotation.inkPaths.map((path) =>
          new PDFArray(path.map((n) => new PDFNumber(n))),
        ),
      );
      dict.set('InkList', inkLists);
      dict.set('BS', buildBorderStyle(annotation.lineWidth));
      appearanceStream = buildInkAppearance(annotation);
      break;

    case 'Stamp':
      dict.set('Subtype', new PDFName('Stamp'));
      dict.set('Name', new PDFName(annotation.stampName));
      appearanceStream = buildStampAppearance(annotation);
      break;

    case 'Redact':
      dict.set('Subtype', new PDFName('Redact'));
      dict.set('QuadPoints', new PDFArray(
        annotation.quadPoints.map((n) => new PDFNumber(n)),
      ));
      if (annotation.overlayText) {
        dict.set('OverlayText', new PDFString(annotation.overlayText));
      }
      // Interior color (fill after redaction)
      dict.set('IC', new PDFArray([
        new PDFNumber(0), new PDFNumber(0), new PDFNumber(0),
      ]));
      break;

    case 'Link':
      dict.set('Subtype', new PDFName('Link'));
      dict.set('Border', new PDFArray([
        new PDFNumber(0), new PDFNumber(0), new PDFNumber(0),
      ]));
      if (annotation.url) {
        const action = new PDFDict();
        action.set('S', new PDFName('URI'));
        action.set('URI', new PDFString(annotation.url));
        dict.set('A', action);
      }
      break;
  }

  // Set appearance stream
  if (appearanceStream) {
    const apDict = new PDFDict();
    apDict.set('N', appearanceStream as unknown as PDFObject);
    dict.set('AP', apDict);
  }

  return { dict, appearanceStream };
}

// ─── Appearance stream builders ─────────────────────────────────────────────

function buildHighlightAppearance(annot: HighlightAnnotation): PDFStream {
  const { rect, color, opacity } = annot;
  const w = rect.width;
  const h = rect.height;

  let streamContent: string;

  switch (annot.type) {
    case 'Highlight':
      streamContent = [
        `${color[0]} ${color[1]} ${color[2]} rg`,
        `0 0 ${w} ${h} re`,
        'f',
      ].join('\n');
      break;

    case 'Underline':
      streamContent = [
        `${color[0]} ${color[1]} ${color[2]} RG`,
        '1 w',
        `0 1 m ${w} 1 l`,
        'S',
      ].join('\n');
      break;

    case 'StrikeOut':
      streamContent = [
        `${color[0]} ${color[1]} ${color[2]} RG`,
        '1 w',
        `0 ${h / 2} m ${w} ${h / 2} l`,
        'S',
      ].join('\n');
      break;

    case 'Squiggly':
      // Approximate squiggly with a zigzag path
      let path = `0 2 m`;
      const step = 4;
      for (let x = step; x <= w; x += step) {
        const y = (x / step) % 2 === 0 ? 2 : 0;
        path += ` ${x} ${y} l`;
      }
      streamContent = [
        `${color[0]} ${color[1]} ${color[2]} RG`,
        '0.8 w',
        path,
        'S',
      ].join('\n');
      break;

    default:
      streamContent = '';
  }

  return buildAppearanceStream(streamContent, rect, opacity);
}

function buildFreeTextAppearance(annot: FreeTextAnnotation): PDFStream {
  const { rect, text, fontSize, textColor, color, borderWidth } = annot;
  const w = rect.width;
  const h = rect.height;

  const lines: string[] = [];

  // Background fill
  lines.push(`${color[0]} ${color[1]} ${color[2]} rg`);
  lines.push(`0 0 ${w} ${h} re f`);

  // Border
  if (borderWidth > 0) {
    lines.push(`0 0 0 RG ${borderWidth} w`);
    lines.push(`0 0 ${w} ${h} re S`);
  }

  // Text
  lines.push('BT');
  lines.push(`${textColor[0]} ${textColor[1]} ${textColor[2]} rg`);
  lines.push(`/Helv ${fontSize} Tf`);
  lines.push(`${borderWidth + 2} ${h - fontSize - borderWidth - 2} Td`);
  lines.push(`(${escapeStringForPDF(text)}) Tj`);
  lines.push('ET');

  const content = lines.join('\n');
  const stream = buildAppearanceStream(content, rect, 1);

  // Add Resources with Helvetica font
  const fontDict = new PDFDict();
  const helvetica = new PDFDict();
  helvetica.set('Type', new PDFName('Font'));
  helvetica.set('Subtype', new PDFName('Type1'));
  helvetica.set('BaseFont', new PDFName('Helvetica'));
  fontDict.set('Helv', helvetica);

  const resources = new PDFDict();
  resources.set('Font', fontDict);
  stream.dict.set('Resources', resources);

  return stream;
}

function buildInkAppearance(annot: InkAnnotation): PDFStream {
  const { rect, color, inkPaths, lineWidth } = annot;
  const lines: string[] = [];

  lines.push(`${color[0]} ${color[1]} ${color[2]} RG`);
  lines.push(`${lineWidth} w`);
  lines.push('1 J'); // Round line cap

  for (const path of inkPaths) {
    if (path.length < 4) continue;

    // Offset coordinates relative to appearance stream BBox
    const x0 = path[0] - rect.x;
    const y0 = path[1] - rect.y;
    lines.push(`${x0} ${y0} m`);

    for (let i = 2; i < path.length; i += 2) {
      const x = path[i] - rect.x;
      const y = path[i + 1] - rect.y;
      lines.push(`${x} ${y} l`);
    }
    lines.push('S');
  }

  return buildAppearanceStream(lines.join('\n'), rect, annot.opacity);
}

function buildStampAppearance(annot: StampAnnotation): PDFStream {
  const { rect, color, stampName } = annot;
  const w = rect.width;
  const h = rect.height;

  const lines: string[] = [];

  // Draw stamp border
  lines.push(`${color[0]} ${color[1]} ${color[2]} RG`);
  lines.push('2 w');
  lines.push(`4 4 ${w - 8} ${h - 8} re S`);

  // Draw stamp text
  lines.push('BT');
  lines.push(`${color[0]} ${color[1]} ${color[2]} rg`);
  const fontSize = Math.min(w / (stampName.length * 0.7), h * 0.5, 24);
  lines.push(`/Helv ${fontSize} Tf`);
  const textX = (w - stampName.length * fontSize * 0.6) / 2;
  const textY = (h - fontSize) / 2;
  lines.push(`${Math.max(4, textX)} ${Math.max(4, textY)} Td`);
  lines.push(`(${escapeStringForPDF(stampName)}) Tj`);
  lines.push('ET');

  const stream = buildAppearanceStream(lines.join('\n'), rect, annot.opacity);

  // Add font resources
  const fontDict = new PDFDict();
  const helvetica = new PDFDict();
  helvetica.set('Type', new PDFName('Font'));
  helvetica.set('Subtype', new PDFName('Type1'));
  helvetica.set('BaseFont', new PDFName('Helvetica'));
  fontDict.set('Helv', helvetica);
  const resources = new PDFDict();
  resources.set('Font', fontDict);
  stream.dict.set('Resources', resources);

  return stream;
}

// ─── Appearance stream helper ───────────────────────────────────────────────

function buildAppearanceStream(
  content: string,
  rect: PDFRectangle,
  opacity: number,
): PDFStream {
  const bytes = new Uint8Array(content.length);
  for (let i = 0; i < content.length; i++) {
    bytes[i] = content.charCodeAt(i) & 0xff;
  }

  const dict = new PDFDict();
  dict.set('Type', new PDFName('XObject'));
  dict.set('Subtype', new PDFName('Form'));
  dict.set('BBox', new PDFArray([
    new PDFNumber(0),
    new PDFNumber(0),
    new PDFNumber(rect.width),
    new PDFNumber(rect.height),
  ]));
  dict.set('Matrix', new PDFArray([
    new PDFNumber(1), new PDFNumber(0),
    new PDFNumber(0), new PDFNumber(1),
    new PDFNumber(0), new PDFNumber(0),
  ]));
  dict.set('Length', new PDFNumber(bytes.length));

  return new PDFStream(dict, bytes, bytes);
}

// ─── Annotation management ──────────────────────────────────────────────────

/**
 * Add an annotation to a page's /Annots array.
 */
export function addAnnotationToPage(
  pageDict: PDFDict,
  annotDict: PDFDict,
  annotRef: PDFRef,
  objects: Map<string, PDFObject>,
): void {
  let annots = pageDict.get('Annots');

  if (!annots) {
    // Create new Annots array
    pageDict.set('Annots', new PDFArray([annotRef]));
  } else if (annots instanceof PDFArray) {
    annots.push(annotRef);
  } else if (annots instanceof PDFRef) {
    // Resolve and add
    const resolved = objects.get(annots.toKey());
    if (resolved instanceof PDFArray) {
      resolved.push(annotRef);
    }
  }

  // Store the annotation object
  objects.set(annotRef.toKey(), annotDict);
}

/**
 * Remove an annotation from a page by its reference.
 */
export function removeAnnotationFromPage(
  pageDict: PDFDict,
  annotRef: PDFRef,
  objects: Map<string, PDFObject>,
): void {
  const annots = pageDict.get('Annots');
  if (!annots) return;

  if (annots instanceof PDFArray) {
    const newItems = annots.items.filter((item) => {
      if (item instanceof PDFRef) return !item.equals(annotRef);
      return true;
    });
    pageDict.set('Annots', new PDFArray(newItems));
  }

  objects.delete(annotRef.toKey());
}

// ─── Utility helpers ────────────────────────────────────────────────────────

function rectToArray(rect: PDFRectangle): PDFArray {
  return new PDFArray([
    new PDFNumber(rect.x),
    new PDFNumber(rect.y),
    new PDFNumber(rect.x + rect.width),
    new PDFNumber(rect.y + rect.height),
  ]);
}

function buildBorderStyle(width: number): PDFDict {
  const bs = new PDFDict();
  bs.set('W', new PDFNumber(width));
  bs.set('S', new PDFName('S')); // Solid
  return bs;
}

function escapeStringForPDF(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

/**
 * Get the current date as a PDF date string.
 */
export function pdfDateString(): string {
  const d = new Date();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `D:${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
