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
import { interpretPage, type DisplayItem, type TextRun, type PathItem, type ImageItem, type GlyphPosition } from '../content/interpreter';
import { buildDocumentFlow, buildFlowDrawIndex, type DocumentFlow, type TextLine } from '../flow';
import type { FlowGlyphDraw } from '../flow/flow-draw';
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
  PDFArray,
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
  /** Raw text runs from the content stream */
  textRuns: TextRun[];
  /** Logical lines (bold + regular grouped) for Word-style editing */
  textLines: TextLine[];
  /** Full document flow model */
  documentFlow: DocumentFlow;
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
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  const logicalWidth = Math.ceil(pageWidth * scale);
  const logicalHeight = Math.ceil(pageHeight * scale);

  canvas.width = Math.ceil(logicalWidth * dpr);
  canvas.height = Math.ceil(logicalHeight * dpr);
  canvas.style.width = `${logicalWidth}px`;
  canvas.style.height = `${logicalHeight}px`;

  const ctx = canvas.getContext('2d')!;

  // Fill background
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Set up coordinate transformation:
  // PDF coordinates: origin at bottom-left, Y goes up
  // Canvas coordinates: origin at top-left, Y goes down
  ctx.save();
  ctx.scale(scale * dpr, scale * dpr);

  // Apply page rotation
  applyPageRotation(ctx, rotate, mediaBox.width, mediaBox.height);

  // Flip Y axis: PDF bottom-left → canvas top-left
  ctx.transform(1, 0, 0, -1, -mediaBox.x, mediaBox.y + mediaBox.height);

  // Get content stream bytes
  const contentBytes = getPageContentBytes(page, objects);

  // Interpret content stream
  const interpreted = interpretPage(contentBytes, page, objects);

  // Build flow model before drawing — justified lines use flow positions
  const documentFlow = buildDocumentFlow(interpreted.textRuns);

  // Load detailed font data
  const fonts = loadPageFonts(page.resources, objects);

  // Register embedded fonts in the browser
  if (typeof window !== 'undefined') {
    await registerEmbeddedFonts(fonts);
  }

  const flowDraw = buildFlowDrawIndex(documentFlow.lines, fonts);
  const drawnJustifiedRuns = new Set<TextRun>();

  // Render display list
  for (let i = 0; i < interpreted.displayList.length; i++) {
    const item = interpreted.displayList[i];

    switch (item.type) {
      case 'path':
        if (renderPaths) drawPath(ctx, item);
        break;
      case 'text':
        if (renderText) {
          drawTextRunWithFlow(ctx, item, fonts, flowDraw, drawnJustifiedRuns);
        }
        break;
      case 'image':
        if (renderImages) await drawImage(ctx, item, page, objects);
        break;
    }
  }

  // Render Annotations (Appearance Streams)
  const annotsRef = page.dict.get('Annots');
  let annotsObj = annotsRef;
  if (annotsRef instanceof PDFRef) {
    annotsObj = resolveRef(annotsRef, objects);
  }
  
  if (annotsObj instanceof PDFArray) {
    for (const annotRef of annotsObj.items) {
      if (!(annotRef instanceof PDFRef)) continue;
      const annotDict = resolveRef(annotRef, objects);
      if (!(annotDict instanceof PDFDict)) continue;

      // Link annotations duplicate page text in hyperref/LaTeX PDFs — skip their
      // appearance streams to avoid rendering text twice on top of itself.
      const subtype = annotDict.get('Subtype');
      const subtypeName = subtype instanceof PDFName ? subtype.name : '';
      if (subtypeName === 'Link' || subtypeName === 'Widget') continue;
      
      const apRef = annotDict.get('AP');
      let apDict = apRef;
      if (apRef instanceof PDFRef) apDict = resolveRef(apRef, objects);
      
      if (apDict instanceof PDFDict) {
        const nRef = apDict.get('N');
        let nStream = nRef;
        if (nRef instanceof PDFRef) nStream = resolveRef(nRef, objects);
        
        if (nStream instanceof PDFStream) {
          // Interpret this Appearance stream
          const annotResources = nStream.dict.get('Resources') || annotDict.get('Resources') || page.dict.get('Resources');
          const mockPage = {
            ...page,
            resources: annotResources instanceof PDFRef ? resolveRef(annotResources, objects) as PDFDict : (annotResources as PDFDict) || new PDFDict(),
          };
          
          // Need to decode the stream if not already decoded
          if (!nStream.decodedBytes) {
             const { applyFilters } = await import('../parser/filters');
             nStream.decodedBytes = await applyFilters(
                 nStream.rawBytes,
                 nStream.getFilters(),
                 nStream.getDecodeParams()
             );
          }
          // Now getBytes() will safely return the uncompressed bytes
          
          const annotInterpreted = interpretPage(nStream.getBytes(), mockPage, objects);
          const annotFonts = loadPageFonts(mockPage.resources, objects);
          if (typeof window !== 'undefined') {
            await registerEmbeddedFonts(annotFonts);
          }
          
          ctx.save();
          
          // Form XObjects (like Appearance streams) have a Matrix mapping from their BBox to the target coord system
          const streamMatrix = nStream.dict.get('Matrix');
          if (streamMatrix instanceof PDFArray && streamMatrix.items.length === 6) {
             const m = streamMatrix.items.map((e: any) => (e as PDFNumber).value);
             // transform takes (a, b, c, d, e, f)
             ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
          } else {
            // If no matrix is provided, it's often positioned via the Rect, so we translate to Rect.x, Rect.y
            const rectObj = annotDict.get('Rect');
            if (rectObj instanceof PDFArray && rectObj.items.length === 4) {
               const x = (rectObj.items[0] as PDFNumber).value;
               const y = (rectObj.items[1] as PDFNumber).value;
               ctx.translate(x, y);
            }
          }

          for (let j = 0; j < annotInterpreted.displayList.length; j++) {
            const item = annotInterpreted.displayList[j];
            switch (item.type) {
              case 'path': if (renderPaths) drawPath(ctx, item); break;
              case 'text': if (renderText) drawTextRun(ctx, item, annotFonts); break;
              case 'image': if (renderImages) await drawImage(ctx, item, mockPage, objects); break;
            }
          }
          ctx.restore();
        }
      }
    }
  }

  ctx.restore();

  return {
    canvas,
    textRuns: interpreted.textRuns,
    textLines: documentFlow.lines,
    documentFlow,
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

/** Strip PDF subset prefix (e.g. "ABCDEF+TimesNewRomanPSMT" → "TimesNewRomanPSMT"). */
function stripFontSubsetPrefix(baseFont: string): string {
  const plus = baseFont.indexOf('+');
  return plus >= 0 ? baseFont.slice(plus + 1) : baseFont;
}

type FlowDrawIndex = ReturnType<typeof buildFlowDrawIndex>;

function drawTextRunWithFlow(
  ctx: CanvasRenderingContext2D,
  run: TextRun,
  fonts: Map<string, FontData>,
  flowDraw: FlowDrawIndex,
  drawnJustifiedRuns: Set<TextRun>,
): void {
  if (drawnJustifiedRuns.has(run)) return;

  const line = flowDraw.runToLine.get(run);
  if (line && flowDraw.justifiedLines.has(line)) {
    drawJustifiedTextLine(ctx, line, flowDraw, fonts, drawnJustifiedRuns);
    return;
  }

  drawTextRun(ctx, run, fonts);
}

function drawJustifiedTextLine(
  ctx: CanvasRenderingContext2D,
  line: TextLine,
  flowDraw: FlowDrawIndex,
  fonts: Map<string, FontData>,
  drawnJustifiedRuns: Set<TextRun>,
): void {
  const drawMap = flowDraw.drawMaps.get(line);
  if (!drawMap) {
    for (let r = 0; r < line.runs.length; r++) {
      drawTextRun(ctx, line.runs[r], fonts);
      drawnJustifiedRuns.add(line.runs[r]);
    }
    return;
  }

  for (let r = 0; r < line.runs.length; r++) {
    const run = line.runs[r];
    const positions = drawMap.get(run);
    if (positions && positions.length > 0) {
      drawTextRunAtPositions(ctx, run, fonts, positions);
    } else {
      drawTextRun(ctx, run, fonts);
    }
    drawnJustifiedRuns.add(run);
  }
}

function drawTextRunAtPositions(
  ctx: CanvasRenderingContext2D,
  run: TextRun,
  fonts: Map<string, FontData>,
  positions: FlowGlyphDraw[],
): void {
  if (positions.length === 0) return;

  ctx.save();
  const fontData = fonts.get(run.fontName);
  const fillColor = rgbToCSSColor(run.fillColor, run.fillAlpha);
  const { family, weight, style } = getCanvasFontProperties(run.fontName, fontData);
  ctx.fillStyle = fillColor;

  for (let i = 0; i < positions.length; i++) {
    drawGlyph(ctx, positions[i].glyph, run, family, weight, style, fillColor, positions[i].x, positions[i].f);
  }

  ctx.restore();
}

function drawTextRun(
  ctx: CanvasRenderingContext2D,
  run: TextRun,
  fonts: Map<string, FontData>,
): void {
  if (run.glyphs.length === 0) return;

  ctx.save();

  const fontData = fonts.get(run.fontName);
  const fillColor = rgbToCSSColor(run.fillColor, run.fillAlpha);
  const { family, weight, style } = getCanvasFontProperties(run.fontName, fontData);
  ctx.fillStyle = fillColor;

  for (let i = 0; i < run.glyphs.length; i++) {
    const glyph = run.glyphs[i];
    drawGlyph(ctx, glyph, run, family, weight, style, fillColor, glyph.tRm.e, glyph.tRm.f);
  }

  ctx.restore();
}

function drawGlyph(
  ctx: CanvasRenderingContext2D,
  glyph: GlyphPosition,
  run: TextRun,
  family: string,
  weight: string,
  style: string,
  fillColor: string,
  x: number,
  f: number,
): void {
  const { tRm } = glyph;
  const effFontSize = Math.sqrt(tRm.c * tRm.c + tRm.d * tRm.d);
  if (effFontSize < 0.1) return;

  ctx.save();
  ctx.transform(
    tRm.a / effFontSize, tRm.b / effFontSize,
    tRm.c / effFontSize, tRm.d / effFontSize,
    x, f,
  );
  ctx.scale(1, -1);
  ctx.font = `${style} ${weight} ${effFontSize}px ${family}`;
  ctx.fillText(glyph.unicode, 0, 0);

  if (run.isUnderline) {
    const underlineY = effFontSize * 0.15;
    const underlineThickness = Math.max(1, effFontSize * 0.05);
    const charWidth = ctx.measureText(glyph.unicode).width;
    ctx.beginPath();
    ctx.moveTo(0, underlineY);
    ctx.lineTo(charWidth, underlineY);
    ctx.lineWidth = underlineThickness;
    ctx.strokeStyle = fillColor;
    ctx.stroke();
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
    const stripped = stripFontSubsetPrefix(fontData.baseFont);
    if (fontData.fontBytes && stripped) {
      // Prefer the stripped name — matches how registerEmbeddedFonts registers faces.
      family = `"${stripped}", "${fontData.baseFont}"`;
      const lower = stripped.toLowerCase();
      weight = lower.includes('bold') ? 'bold' : 'normal';
      style = (lower.includes('italic') || lower.includes('oblique')) ? 'italic' : 'normal';
      return { family, weight, style };
    }

    const std = fontData.standardMetrics;
    if (std) {
      family = std.cssFamily;
      weight = std.isBold ? 'bold' : 'normal';
      style = std.isItalic ? 'italic' : 'normal';
    } else {
      const lower = stripped.toLowerCase();
      weight = lower.includes('bold') ? 'bold' : 'normal';
      style = (lower.includes('italic') || lower.includes('oblique')) ? 'italic' : 'normal';

      if (lower.includes('courier') || lower.includes('mono') || lower.includes('cmtt') || lower.includes('lmtt')) {
        family = '"Courier New", Courier, monospace';
      } else if (
        lower.includes('times') || lower.includes('roman') ||
        lower.includes('cmr') || lower.includes('lmr') || lower.includes('ptm')
      ) {
        family = '"Times New Roman", Times, serif';
      } else if (lower.includes('helv') || lower.includes('arial') || lower.includes('cms') || lower.includes('lmss')) {
        family = 'Helvetica, Arial, sans-serif';
      } else {
        family = `"${stripped}", serif`;
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

async function registerEmbeddedFonts(fonts: Map<string, FontData>): Promise<void> {
  const promises: Promise<void>[] = [];
  const registered = new Set<string>();

  for (const [, fontData] of fonts.entries()) {
    if (!fontData.fontBytes || !fontData.baseFont) continue;

    const names = new Set<string>();
    names.add(fontData.baseFont);
    const stripped = stripFontSubsetPrefix(fontData.baseFont);
    if (stripped) names.add(stripped);

    for (const familyName of names) {
      if (registered.has(familyName)) continue;

      let alreadyLoaded = false;
      try {
        alreadyLoaded = document.fonts.check(`12px "${familyName}"`);
      } catch {
        // ignore
      }

      if (!alreadyLoaded) {
        const fontFace = new FontFace(familyName, fontData.fontBytes.buffer.slice(
          fontData.fontBytes.byteOffset,
          fontData.fontBytes.byteOffset + fontData.fontBytes.byteLength,
        ) as ArrayBuffer);
        const p = fontFace.load().then((loadedFace) => {
          document.fonts.add(loadedFace);
          registered.add(familyName);
        }).catch((e) => {
          console.warn(`[Renderer] Failed to load font face for "${familyName}":`, e);
        });
        promises.push(p);
      } else {
        registered.add(familyName);
      }
    }
  }

  if (promises.length > 0) {
    await Promise.all(promises);
  }
}

