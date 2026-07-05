/**
 * Watermark Engine — Core
 *
 * Provides the ability to add watermarks to PDF pages. Watermarks can be:
 *   - Text watermarks (diagonal, horizontal, tiled)
 *   - Image watermarks (logos, stamps)
 *   - Pattern watermarks (repeating text/images)
 *
 * Watermarks are injected directly into the page's content stream as
 * PDF graphics operators, making them real PDF content (not annotations).
 * This ensures they render correctly in any PDF viewer and survive
 * document processing.
 *
 * The engine supports:
 *   - Opacity/transparency control
 *   - Rotation and positioning
 *   - Tiling/repeating patterns
 *   - Layering (above or below existing content)
 *   - Font selection and sizing
 */

import {
  PDFArray,
  PDFDict,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFStream,
  PDFString,
  type PDFPageInfo,
} from '../types';
import { resolveRef } from '../parser/parser';
import { flateEncode } from '../parser/filters';

// ─── Watermark types ────────────────────────────────────────────────────────

export type WatermarkType = 'text' | 'image' | 'pattern';

export interface WatermarkBase {
  /** Unique identifier for this watermark */
  id: string;
  /** Type of watermark */
  type: WatermarkType;
  /** Opacity (0-1, where 1 = fully opaque) */
  opacity: number;
  /** Rotation angle in degrees (counter-clockwise) */
  rotation: number;
  /** Whether to tile/repeat across the page */
  tile: boolean;
  /** Layer: 'above' draws over content, 'below' draws under content */
  layer: 'above' | 'below';
  /** Page indices to apply to (empty = all pages) */
  pageIndices?: number[];
}

export interface TextWatermark extends WatermarkBase {
  type: 'text';
  /** The text to render as watermark */
  text: string;
  /** Font name (e.g., 'Helvetica', 'Times-Roman', 'Courier') */
  fontName: string;
  /** Font size in points */
  fontSize: number;
  /** Text color as RGB (0-1) */
  color: [number, number, number];
  /** Position: 'center', 'top-left', 'top-right', 'bottom-left', 'bottom-right', or custom [x, y] */
  position: WatermarkPosition | [number, number];
  /** Spacing between tiles when tiling (in points) */
  tileSpacing?: number;
}

export interface ImageWatermark extends WatermarkBase {
  type: 'image';
  /** Raw image bytes (JPEG or PNG) */
  imageBytes: Uint8Array;
  /** Image MIME type */
  mimeType: 'image/jpeg' | 'image/png';
  /** Width in PDF points (user space units) */
  width: number;
  /** Height in PDF points */
  height: number;
  /** Position */
  position: WatermarkPosition | [number, number];
  /** Tile spacing */
  tileSpacing?: number;
}

export interface PatternWatermark extends WatermarkBase {
  type: 'pattern';
  /** The text to repeat */
  text: string;
  /** Font name */
  fontName: string;
  /** Font size */
  fontSize: number;
  /** Color */
  color: [number, number, number];
  /** Horizontal spacing between repeats */
  hSpacing: number;
  /** Vertical spacing between repeats */
  vSpacing: number;
  /** Stagger offset for alternating rows */
  stagger?: number;
}

export type WatermarkPosition =
  | 'center'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top-center'
  | 'bottom-center';

export type Watermark = TextWatermark | ImageWatermark | PatternWatermark;

// ─── Watermark application ──────────────────────────────────────────────────

/**
 * Generate PDF content stream operators for a text watermark.
 * Returns the raw content bytes to inject into the page stream.
 */
export function buildTextWatermarkContent(wm: TextWatermark, pageWidth: number, pageHeight: number): Uint8Array {
  const lines: string[] = [];

  // Save graphics state
  lines.push('q');

  // Set opacity via ExtGState if needed
  if (wm.opacity < 1) {
    lines.push(`/${getExtGStateName(wm.id)} gs`);
  }

  // Set fill color
  const [r, g, b] = wm.color;
  lines.push(`${fmtNum(r)} ${fmtNum(g)} ${fmtNum(b)} rg`);
  lines.push(`${fmtNum(r)} ${fmtNum(g)} ${fmtNum(b)} RG`);

  // Set font
  lines.push(`/${wm.fontName} ${wm.fontSize} Tf`);

  if (wm.tile) {
    // Tiled text watermark — draw text at grid positions
    const spacing = wm.tileSpacing || 300;
    const cols = Math.ceil(pageWidth / spacing) + 1;
    const rows = Math.ceil(pageHeight / spacing) + 1;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * spacing - spacing / 2;
        const y = row * spacing - spacing / 2;

        lines.push('q');
        // Translate to position, rotate
        lines.push(`1 0 0 1 ${fmtNum(x)} ${fmtNum(y)} cm`);
        if (wm.rotation !== 0) {
          const rad = (wm.rotation * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          lines.push(`${fmtNum(cos)} ${fmtNum(sin)} ${fmtNum(-sin)} ${fmtNum(cos)} 0 0 cm`);
        }
        // Draw text centered
        lines.push('BT');
        lines.push(`0 0 Td`);
        lines.push(`(${escapePDFString(wm.text)}) Tj`);
        lines.push('ET');
        lines.push('Q');
      }
    }
  } else {
    // Single watermark at specified position
    const [px, py] = resolvePosition(wm.position, pageWidth, pageHeight);

    lines.push('q');
    lines.push(`1 0 0 1 ${fmtNum(px)} ${fmtNum(py)} cm`);

    if (wm.rotation !== 0) {
      const rad = (wm.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      lines.push(`${fmtNum(cos)} ${fmtNum(sin)} ${fmtNum(-sin)} ${fmtNum(cos)} 0 0 cm`);
    }

    lines.push('BT');
    lines.push(`0 0 Td`);
    lines.push(`(${escapePDFString(wm.text)}) Tj`);
    lines.push('ET');
    lines.push('Q');
  }

  // Restore graphics state
  lines.push('Q');

  return stringToBytes(lines.join('\n') + '\n');
}

/**
 * Generate PDF content stream operators for an image watermark.
 */
export function buildImageWatermarkContent(
  wm: ImageWatermark,
  pageWidth: number,
  pageHeight: number,
  imageXObjectName: string,
): Uint8Array {
  const lines: string[] = [];

  lines.push('q');

  if (wm.opacity < 1) {
    lines.push(`/${getExtGStateName(wm.id)} gs`);
  }

  if (wm.tile) {
    const spacing = wm.tileSpacing || 300;
    const cols = Math.ceil(pageWidth / spacing) + 1;
    const rows = Math.ceil(pageHeight / spacing) + 1;

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const x = col * spacing - spacing / 2 - wm.width / 2;
        const y = row * spacing - spacing / 2 - wm.height / 2;

        lines.push('q');
        lines.push(`1 0 0 1 ${fmtNum(x)} ${fmtNum(y)} cm`);
        if (wm.rotation !== 0) {
          const rad = (wm.rotation * Math.PI) / 180;
          const cos = Math.cos(rad);
          const sin = Math.sin(rad);
          lines.push(`${fmtNum(cos)} ${fmtNum(sin)} ${fmtNum(-sin)} ${fmtNum(cos)} 0 0 cm`);
        }
        lines.push(`${fmtNum(wm.width)} 0 0 ${fmtNum(wm.height)} 0 0 cm`);
        lines.push(`/${imageXObjectName} Do`);
        lines.push('Q');
      }
    }
  } else {
    const [px, py] = resolvePosition(wm.position, pageWidth, pageHeight);
    const x = px - wm.width / 2;
    const y = py - wm.height / 2;

    lines.push(`1 0 0 1 ${fmtNum(x)} ${fmtNum(y)} cm`);
    if (wm.rotation !== 0) {
      const rad = (wm.rotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      lines.push(`${fmtNum(cos)} ${fmtNum(sin)} ${fmtNum(-sin)} ${fmtNum(cos)} 0 0 cm`);
    }
    lines.push(`${fmtNum(wm.width)} 0 0 ${fmtNum(wm.height)} 0 0 cm`);
    lines.push(`/${imageXObjectName} Do`);
  }

  lines.push('Q');

  return stringToBytes(lines.join('\n') + '\n');
}

/**
 * Generate PDF content stream operators for a pattern watermark.
 */
export function buildPatternWatermarkContent(wm: PatternWatermark, pageWidth: number, pageHeight: number): Uint8Array {
  const lines: string[] = [];

  lines.push('q');

  if (wm.opacity < 1) {
    lines.push(`/${getExtGStateName(wm.id)} gs`);
  }

  const [r, g, b] = wm.color;
  lines.push(`${fmtNum(r)} ${fmtNum(g)} ${fmtNum(b)} rg`);
  lines.push(`/${wm.fontName} ${wm.fontSize} Tf`);

  const cols = Math.ceil(pageWidth / wm.hSpacing) + 1;
  const rows = Math.ceil(pageHeight / wm.vSpacing) + 1;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      let x = col * wm.hSpacing;
      let y = row * wm.vSpacing;

      // Apply stagger for alternating rows
      if (wm.stagger && row % 2 === 1) {
        x += wm.stagger;
      }

      lines.push('BT');
      lines.push(`${fmtNum(x)} ${fmtNum(y)} Td`);
      if (wm.rotation !== 0) {
        const rad = (wm.rotation * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        lines.push(`${fmtNum(cos)} ${fmtNum(sin)} ${fmtNum(-sin)} ${fmtNum(cos)} 0 0 Tm`);
      }
      lines.push(`(${escapePDFString(wm.text)}) Tj`);
      lines.push('ET');
    }
  }

  lines.push('Q');

  return stringToBytes(lines.join('\n') + '\n');
}

/**
 * Create an ExtGState dictionary for opacity control.
 * Returns the dictionary and its name.
 */
export function createOpacityExtGState(
  opacity: number,
  gsName: string,
): { dict: PDFDict; name: string } {
  const dict = new PDFDict();
  dict.set('Type', new PDFName('ExtGState'));
  dict.set('ca', new PDFNumber(opacity));   // non-stroking alpha
  dict.set('CA', new PDFNumber(opacity));   // stroking alpha
  dict.set('BM', new PDFName('Normal'));

  return { dict, name: gsName };
}

/**
 * Create an Image XObject for an image watermark.
 */
export function createWatermarkImageXObject(
  wm: ImageWatermark,
): { stream: PDFStream; name: string } {
  const dict = new PDFDict();
  dict.set('Type', new PDFName('XObject'));
  dict.set('Subtype', new PDFName('Image'));
  dict.set('Width', new PDFNumber(wm.width));
  dict.set('Height', new PDFNumber(wm.height));
  dict.set('ColorSpace', new PDFName('DeviceRGB'));
  dict.set('BitsPerComponent', new PDFNumber(8));

  if (wm.mimeType === 'image/jpeg') {
    dict.set('Filter', new PDFName('DCTDecode'));
  } else {
    dict.set('Filter', new PDFName('FlateDecode'));
    // For PNG we'd need to decode first — simplified here
  }

  dict.set('Length', new PDFNumber(wm.imageBytes.length));

  const stream = new PDFStream(dict, wm.imageBytes);
  const name = `/ImWM_${wm.id.substring(0, 8)}`;

  return { stream, name };
}

/**
 * Apply a watermark to a page's content stream.
 *
 * @param contentBytes Original decoded content stream bytes
 * @param page Page info for accessing resources
 * @param objects Document object map (will be mutated with new resources)
 * @param watermark The watermark to apply
 * @param pageWidth Page width in PDF points
 * @param pageHeight Page height in PDF points
 * @param getNextObjNum Function to get the next available object number
 * @returns Modified content stream bytes
 */
export function applyWatermarkToPage(
  contentBytes: Uint8Array,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  watermark: Watermark,
  pageWidth: number,
  pageHeight: number,
  getNextObjNum: () => number,
): Uint8Array {
  let watermarkContent: Uint8Array;
  let needsExtGState = watermark.opacity < 1;
  let needsImageXObject = watermark.type === 'image';

  // Build the watermark content operators
  switch (watermark.type) {
    case 'text':
      watermarkContent = buildTextWatermarkContent(watermark, pageWidth, pageHeight);
      break;
    case 'image': {
      const imgWm = watermark as ImageWatermark;
      const { stream, name } = createWatermarkImageXObject(imgWm);
      const objNum = getNextObjNum();
      const objRef = new PDFRef(objNum, 0);
      objects.set(objRef.toKey(), stream);

      // Register in page Resources
      registerXObjectInResources(page, objects, name.replace('/', ''), objRef);

      watermarkContent = buildImageWatermarkContent(imgWm, pageWidth, pageHeight, name);
      break;
    }
    case 'pattern':
      watermarkContent = buildPatternWatermarkContent(watermark, pageWidth, pageHeight);
      break;
    default:
      watermarkContent = new Uint8Array(0);
  }

  // Create ExtGState for opacity if needed
  if (needsExtGState) {
    const gsName = getExtGStateName(watermark.id);
    const { dict } = createOpacityExtGState(watermark.opacity, gsName);
    const objNum = getNextObjNum();
    const objRef = new PDFRef(objNum, 0);
    objects.set(objRef.toKey(), dict);

    registerExtGStateInResources(page, objects, gsName, objRef);
  }

  // Inject watermark content into the page stream
  // If layer is 'below', prepend; if 'above', append
  const combined = new Uint8Array(contentBytes.length + watermarkContent.length + 2);

  if (watermark.layer === 'below') {
    // Watermark goes first (renders under existing content)
    combined.set(watermarkContent, 0);
    combined.set(contentBytes, watermarkContent.length);
  } else {
    // Watermark goes last (renders over existing content)
    combined.set(contentBytes, 0);
    combined.set(watermarkContent, contentBytes.length);
  }

  return combined;
}

/**
 * Apply watermarks to multiple pages.
 */
export function applyWatermarks(
  doc: { pages: PDFPageInfo[]; objects: Map<string, PDFObject> },
  watermarks: Watermark[],
  getNextObjNum: () => number,
): Map<number, Uint8Array> {
  const results = new Map<number, Uint8Array>();

  for (const wm of watermarks) {
    const targetPages = wm.pageIndices && wm.pageIndices.length > 0
      ? wm.pageIndices
      : doc.pages.map((_, i) => i);

    for (const pageIdx of targetPages) {
      if (pageIdx < 0 || pageIdx >= doc.pages.length) continue;
      const page = doc.pages[pageIdx];
      const pageWidth = page.mediaBox.width;
      const pageHeight = page.mediaBox.height;

      // Get current content bytes
      const currentBytes = results.get(pageIdx) || getPageContentBytesRaw(page, doc.objects);

      const newBytes = applyWatermarkToPage(
        currentBytes, page, doc.objects, wm,
        pageWidth, pageHeight, getNextObjNum,
      );
      results.set(pageIdx, newBytes);
    }
  }

  return results;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getPageContentBytesRaw(page: PDFPageInfo, objects: Map<string, PDFObject>): Uint8Array {
  // Try to get decoded content bytes from the page's content stream(s)
  const contents = page.dict.get('Contents');
  if (!contents) return new Uint8Array(0);

  const refs: PDFRef[] = [];
  if (contents instanceof PDFRef) {
    refs.push(contents);
  } else if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.length; i++) {
      const item = contents.get(i);
      if (item instanceof PDFRef) refs.push(item);
    }
  }

  // Concatenate decoded bytes from all content streams
  const chunks: Uint8Array[] = [];
  for (const ref of refs) {
    const obj = objects.get(ref.toKey());
    if (obj instanceof PDFStream) {
      chunks.push(obj.decodedBytes || obj.rawBytes);
    }
  }

  if (chunks.length === 0) return new Uint8Array(0);
  if (chunks.length === 1) return chunks[0];

  const totalLen = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

function registerXObjectInResources(
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  name: string,
  ref: PDFRef,
): void {
  const resources = getOrCreateResourcesDict(page, objects);
  let xobjects = resources.get('XObject');
  if (xobjects instanceof PDFRef) {
    xobjects = objects.get(xobjects.toKey()) as PDFDict;
  }
  if (!xobjects || !(xobjects instanceof PDFDict)) {
    xobjects = new PDFDict();
    resources.set('XObject', xobjects);
  }
  xobjects.set(name, ref);
}

function registerExtGStateInResources(
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  name: string,
  ref: PDFRef,
): void {
  const resources = getOrCreateResourcesDict(page, objects);
  let extGState = resources.get('ExtGState');
  if (extGState instanceof PDFRef) {
    extGState = objects.get(extGState.toKey()) as PDFDict;
  }
  if (!extGState || !(extGState instanceof PDFDict)) {
    extGState = new PDFDict();
    resources.set('ExtGState', extGState);
  }
  extGState.set(name, ref);
}

function getOrCreateResourcesDict(page: PDFPageInfo, objects: Map<string, PDFObject>): PDFDict {
  const resourcesObj = page.dict.get('Resources');
  let resources: PDFDict;
  if (resourcesObj instanceof PDFRef) {
    const resolved = objects.get(resourcesObj.toKey());
    if (resolved instanceof PDFDict) {
      resources = resolved;
    } else {
      resources = new PDFDict();
      page.dict.set('Resources', resources);
    }
  } else if (resourcesObj instanceof PDFDict) {
    resources = resourcesObj;
  } else {
    resources = new PDFDict();
    page.dict.set('Resources', resources);
  }
  return resources;
}

function resolvePosition(
  position: WatermarkPosition | [number, number],
  pageWidth: number,
  pageHeight: number,
): [number, number] {
  if (Array.isArray(position)) return position;

  switch (position) {
    case 'center': return [pageWidth / 2, pageHeight / 2];
    case 'top-left': return [pageWidth * 0.15, pageHeight * 0.85];
    case 'top-right': return [pageWidth * 0.85, pageHeight * 0.85];
    case 'bottom-left': return [pageWidth * 0.15, pageHeight * 0.15];
    case 'bottom-right': return [pageWidth * 0.85, pageHeight * 0.15];
    case 'top-center': return [pageWidth / 2, pageHeight * 0.85];
    case 'bottom-center': return [pageWidth / 2, pageHeight * 0.15];
    default: return [pageWidth / 2, pageHeight / 2];
  }
}

function getExtGStateName(watermarkId: string): string {
  return `GS_wm_${watermarkId.substring(0, 8)}`;
}

function escapePDFString(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)')
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n');
}

function fmtNum(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  const s = n.toFixed(4);
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

function stringToBytes(s: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(s);
}