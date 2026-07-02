/**
 * PDF Page Renderer
 *
 * Renders a parsed PDF page to an HTML5 Canvas using our own engine.
 * This replaces PDF.js entirely.
 *
 * Pipeline:
 *   1. Parse page content stream → CSInstructions
 *   2. Interpret instructions → display list (text, paths, images)
 *   3. Draw display list items to CanvasRenderingContext2D
 *
 * Supports:
 *   - Text rendering with font matching
 *   - Path construction and painting (fill, stroke, clip)
 *   - Image XObjects (JPEG, raw pixel data)
 *   - Color spaces (RGB, Gray, CMYK, Indexed, CalRGB, ICCBased)
 *   - Transparency (fill/stroke alpha, SMask)
 *   - Page rotation and scaling
 */

import { parsePDF, getPageContentBytes, resolveRef, getResource } from '../parser/parser';
import { interpretPage, type DisplayItem, type TextRun, type PathItem, type ImageItem } from '../content/interpreter';
import { loadPageFonts, type FontData } from '../fonts/font-parser';
import { getCSSFontFamily, getStandardFont } from '../fonts/standard14';
import { decodeImage } from './image-decoder';
import { rgbToCSSColor } from './color-space';
import {
  PDFDict,
  PDFName,
  PDFNumber,
  PDFObject,
  PDFRef,
  PDFStream,
  type PDFDocumentData,
  type PDFPageInfo,
} from '../types';

// ─── Render options ─────────────────────────────────────────────────────────

export interface RenderOptions {
  /** Scale factor (1.0 = 72 DPI, 2.0 = 144 DPI, etc.) */
  scale: number;
  /** Background color (default: white) */
  background?: string;
  /** Whether to render text (default: true) */
  renderText?: boolean;
  /** Whether to render paths (default: true) */
  renderPaths?: boolean;
  /** Whether to render images (default: true) */
  renderImages?: boolean;
}

// ─── Render result ──────────────────────────────────────────────────────────

export interface RenderResult {
  /** The rendered canvas */
  canvas: HTMLCanvasElement;
  /** Text runs with positions (for text selection / editing) */
  textRuns: TextRun[];
  /** Font data loaded for this page */
  fonts: Map<string, FontData>;
  /** Page dimensions in PDF points */
  pageWidth: number;
  pageHeight: number;
}

// ─── Main render functions ──────────────────────────────────────────────────

/**
 * Render a single page from a parsed PDF document to a canvas.
 */
export async function renderPage(
  doc: PDFDocumentData,
  pageIndex: number,
  options: RenderOptions,
): Promise<RenderResult> {
  if (pageIndex < 0 || pageIndex >= doc.pages.length) {
    throw new Error(`Page index ${pageIndex} out of range (0-${doc.pages.length - 1})`);
  }

  const page = doc.pages[pageIndex];
  return renderPageToCanvas(page, doc.objects, options);
}

/**
 * Render a page to a new canvas element.
 */
export async function renderPageToCanvas(
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  options: RenderOptions,
): Promise<RenderResult> {
  const scale = options.scale ?? 1;
  const background = options.background ?? '#ffffff';
  const renderText = options.renderText ?? true;
  const renderPaths = options.renderPaths ?? true;
  const renderImages = options.renderImages ?? true;

  // Compute page dimensions (accounting for rotation)
  const { mediaBox, rotate } = page;
  const isRotated = rotate === 90 || rotate === 270;
  const pageWidth = isRotated ? mediaBox.height : mediaBox.width;
  const pageHeight = isRotated ? mediaBox.width : mediaBox.height;

  // Create canvas
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(pageWidth * scale);
  canvas.height = Math.ceil(pageHeight * scale);

  const ctx = canvas.getContext('2d')!;

  // Fill background
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Set up coordinate transformation:
  // PDF coordinates: origin at bottom-left, Y goes up
  // Canvas coordinates: origin at top-left, Y goes down
  ctx.save();
  ctx.scale(scale, scale);

  // Apply page rotation
  applyPageRotation(ctx, rotate, mediaBox.width, mediaBox.height);

  // Flip Y axis: PDF bottom-left → canvas top-left
  ctx.transform(1, 0, 0, -1, -mediaBox.x, mediaBox.y + mediaBox.height);

  // Get content stream bytes
  const contentBytes = getPageContentBytes(page, objects);

  // Interpret content stream
  const interpreted = interpretPage(contentBytes, page, objects);

  // Load detailed font data
  const fonts = loadPageFonts(page.resources, objects);

  // Render display list
  for (let i = 0; i < interpreted.displayList.length; i++) {
    const item = interpreted.displayList[i];

    switch (item.type) {
      case 'path':
        if (renderPaths) drawPath(ctx, item);
        break;
      case 'text':
        if (renderText) drawTextRun(ctx, item, fonts);
        break;
      case 'image':
        if (renderImages) await drawImage(ctx, item, page, objects);
        break;
    }
  }

  ctx.restore();

  return {
    canvas,
    textRuns: interpreted.textRuns,
    fonts,
    pageWidth,
    pageHeight,
  };
}

// ─── Page rotation ──────────────────────────────────────────────────────────

function applyPageRotation(
  ctx: CanvasRenderingContext2D,
  rotate: number,
  width: number,
  height: number,
): void {
  switch (rotate) {
    case 90:
      ctx.translate(height, 0);
      ctx.rotate(Math.PI / 2);
      break;
    case 180:
      ctx.translate(width, height);
      ctx.rotate(Math.PI);
      break;
    case 270:
      ctx.translate(0, width);
      ctx.rotate(-Math.PI / 2);
      break;
    default:
      break;
  }
}

// ─── Path rendering ─────────────────────────────────────────────────────────

function drawPath(ctx: CanvasRenderingContext2D, item: PathItem): void {
  if (item.segments.length === 0) return;

  ctx.save();
  ctx.beginPath();

  for (let i = 0; i < item.segments.length; i++) {
    const seg = item.segments[i];
    switch (seg.type) {
      case 'M':
        ctx.moveTo(seg.points[0], seg.points[1]);
        break;
      case 'L':
        ctx.lineTo(seg.points[0], seg.points[1]);
        break;
      case 'C':
        ctx.bezierCurveTo(
          seg.points[0], seg.points[1],
          seg.points[2], seg.points[3],
          seg.points[4], seg.points[5],
        );
        break;
      case 'Z':
        ctx.closePath();
        break;
    }
  }

  // Paint
  if (item.paintType === 'fill' || item.paintType === 'both') {
    if (item.fillColor) {
      ctx.fillStyle = rgbToCSSColor(item.fillColor, item.fillAlpha);
      ctx.fill();
    }
  }

  if (item.paintType === 'stroke' || item.paintType === 'both') {
    if (item.strokeColor) {
      ctx.strokeStyle = rgbToCSSColor(item.strokeColor, item.strokeAlpha);
      ctx.lineWidth = item.lineWidth;
      ctx.stroke();
    }
  }

  ctx.restore();
}

// ─── Text rendering ─────────────────────────────────────────────────────────

function drawTextRun(
  ctx: CanvasRenderingContext2D,
  run: TextRun,
  fonts: Map<string, FontData>,
): void {
  if (run.glyphs.length === 0) return;

  ctx.save();

  const fontData = fonts.get(run.fontName);
  const fillColor = rgbToCSSColor(run.fillColor, run.fillAlpha);

  // Get CSS font properties
  const { family, weight, style } = getCanvasFontProperties(run.fontName, fontData);
  ctx.fillStyle = fillColor;

  // We draw at a fixed high resolution and scale the context, this ensures
  // both high visual quality and accurate text placement/stretching (scaleX vs scaleY).
  const FONT_RESOLUTION = 100;
  ctx.font = `${style} ${weight} ${FONT_RESOLUTION}px ${family}`;

  for (let i = 0; i < run.glyphs.length; i++) {
    const glyph = run.glyphs[i];
    const { tRm } = glyph;

    ctx.save();
    
    // Apply exact Text Rendering Matrix from Glyph Space to User Space
    ctx.transform(tRm.a, tRm.b, tRm.c, tRm.d, tRm.e, tRm.f);
    
    // Scale down from our 100px resolution
    ctx.scale(1 / FONT_RESOLUTION, 1 / FONT_RESOLUTION);
    
    // Determine horizontal stretch to match exact PDF glyph width
    // The intended width in this space is textSpaceWidth * FONT_RESOLUTION
    const intendedWidth = glyph.textSpaceWidth * FONT_RESOLUTION;
    const actualWidth = ctx.measureText(glyph.unicode).width;
    
    // Only scale if actual width is non-zero (prevent Infinity/NaN) and different
    if (actualWidth > 0 && intendedWidth > 0 && glyph.unicode.trim() !== '') {
      const stretch = intendedWidth / actualWidth;
      ctx.scale(stretch, 1);
    }

    // Canvas coordinate system has Y down, while PDF has Y up.
    // The CTM/tRm already preserves the Y-up coordinate space, 
    // but the canvas text renderer expects to draw Y-down.
    // So we flip the Y axis just for the text stroke.
    ctx.scale(1, -1);
    
    ctx.fillText(glyph.unicode, 0, 0);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Extract CSS font properties (family, style, weight) without the size,
 * because size is handled by the transformation matrix.
 */
function getCanvasFontProperties(
  fontName: string,
  fontData?: FontData,
): { family: string; weight: string; style: string } {
  let family = 'sans-serif';
  let weight = 'normal';
  let style = 'normal';

  if (fontData) {
    const std = fontData.standardMetrics;
    if (std) {
      family = std.cssFamily;
      weight = std.isBold ? 'bold' : 'normal';
      style = std.isItalic ? 'italic' : 'normal';
    } else {
      const lower = fontData.baseFont.toLowerCase();
      weight = lower.includes('bold') ? 'bold' : 'normal';
      style = (lower.includes('italic') || lower.includes('oblique')) ? 'italic' : 'normal';

      if (lower.includes('courier') || lower.includes('mono')) {
        family = '"Courier New", monospace';
      } else if (lower.includes('times') || lower.includes('roman')) {
        family = '"Times New Roman", serif';
      } else {
        family = 'Helvetica, Arial, sans-serif';
      }
    }
  } else {
    family = getCSSFontFamily(fontName);
    const lower = fontName.toLowerCase();
    weight = lower.includes('bold') ? 'bold' : 'normal';
    style = (lower.includes('italic') || lower.includes('oblique')) ? 'italic' : 'normal';
  }

  return { family, weight, style };
}

/**
 * Build a CSS font string for canvas rendering.
 * Takes into account the text matrix scaling to get the right visual size.
 */
function buildCanvasFont(
  fontName: string,
  fontSize: number,
  textMatrix: { a: number; b: number; c: number; d: number },
  fontData?: FontData,
): string {
  // Compute effective font size from the text matrix
  const scaleY = Math.sqrt(textMatrix.b * textMatrix.b + textMatrix.d * textMatrix.d);
  const effectiveSize = Math.abs(fontSize * scaleY) || fontSize;

  const { family, weight, style } = getCanvasFontProperties(fontName, fontData);

  // Canvas font format: "style weight size family"
  return `${style} ${weight} ${effectiveSize}px ${family}`;
}

// ─── Image rendering ────────────────────────────────────────────────────────

async function drawImage(
  ctx: CanvasRenderingContext2D,
  item: ImageItem,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
): Promise<void> {
  // Get the image XObject
  const xobj = getResource(page.resources, 'XObject', item.name, objects);
  if (!(xobj instanceof PDFStream)) return;

  const decoded = await decodeImage(xobj, objects);
  if (!decoded) return;

  // Create ImageData and draw it
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const imageData = new ImageData(decoded.data as any, decoded.width, decoded.height);

    ctx.save();

    // Apply the CTM to position and scale the image
    // The image is defined in a 1×1 unit square that the CTM scales
    ctx.transform(
      item.ctm.a, item.ctm.b,
      item.ctm.c, item.ctm.d,
      item.ctm.e, item.ctm.f,
    );

    // Create a temporary canvas to draw the ImageData
    const tmpCanvas = new OffscreenCanvas(decoded.width, decoded.height);
    const tmpCtx = tmpCanvas.getContext('2d')!;
    tmpCtx.putImageData(imageData, 0, 0);

    // Draw the image into the 1×1 unit square
    // The CTM has already scaled it to the correct size
    ctx.scale(1 / decoded.width, -1 / decoded.height);
    ctx.translate(0, -decoded.height);
    ctx.drawImage(tmpCanvas, 0, 0);

    ctx.restore();
  } catch (e) {
    console.warn(`[Renderer] Failed to draw image ${item.name}:`, e);
  }
}

// ─── Convenience: render PDF bytes to canvas directly ───────────────────────

/**
 * Parse raw PDF bytes and render a page to canvas in one call.
 * This is the simplest entry point for rendering.
 */
export async function renderPDFPage(
  pdfBytes: Uint8Array,
  pageIndex: number = 0,
  scale: number = 1.5,
): Promise<RenderResult> {
  const doc = await parsePDF(pdfBytes);
  return renderPage(doc, pageIndex, { scale });
}

/**
 * Render all pages of a PDF document.
 */
export async function renderAllPages(
  doc: PDFDocumentData,
  options: RenderOptions,
): Promise<RenderResult[]> {
  const results: RenderResult[] = [];
  for (let i = 0; i < doc.pages.length; i++) {
    const result = await renderPage(doc, i, options);
    results.push(result);
  }
  return results;
}
