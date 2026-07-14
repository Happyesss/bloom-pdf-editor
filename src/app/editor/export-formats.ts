/**
 * Client-side export logic for all formats.
 *
 * Uses the `docx` npm library for high-fidelity Word export with absolute
 * text positioning via Textbox elements (the same technique used by
 * professional tools like iLovePDF and Sejda).
 *
 * Image exports (PNG/JPEG/SVG) render each page through the engine's
 * canvas renderer at the requested DPI for pixel-perfect output.
 */

import type { PDFDocumentData, ExportPageInput, TextLine } from '@/engine';
import type { TextRun as EngineTextRun } from '@/engine';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ExportFormat = 'png' | 'jpeg' | 'svg' | 'html' | 'markdown' | 'txt' | 'docx';

export interface ExportFormatInfo {
  id: ExportFormat;
  label: string;
  description: string;
  extension: string;
  icon: string;
  mimeType: string;
  supportsQuality: boolean;
  supportsDpi: boolean;
  supportsPageRange: boolean;
}

export const EXPORT_FORMATS: ExportFormatInfo[] = [
  {
    id: 'docx',
    label: 'Word Document',
    description: 'Export as .docx — layout preserved with absolute positioning',
    extension: '.docx',
    icon: '📄',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    supportsQuality: false,
    supportsDpi: false,
    supportsPageRange: true,
  },
  {
    id: 'html',
    label: 'HTML',
    description: 'Exact-layout HTML with text, images, headings & tables',
    extension: '.html',
    icon: '🌐',
    mimeType: 'text/html',
    supportsQuality: false,
    supportsDpi: false,
    supportsPageRange: true,
  },
  {
    id: 'markdown',
    label: 'Markdown',
    description: 'Structured Markdown — headings, lists, tables, images',
    extension: '.md',
    icon: '📝',
    mimeType: 'text/markdown',
    supportsQuality: false,
    supportsDpi: false,
    supportsPageRange: true,
  },
  {
    id: 'png',
    label: 'PNG Image',
    description: 'Lossless, pixel-perfect render at chosen DPI',
    extension: '.png',
    icon: '🖼️',
    mimeType: 'image/png',
    supportsQuality: false,
    supportsDpi: true,
    supportsPageRange: true,
  },
  {
    id: 'jpeg',
    label: 'JPEG Image',
    description: 'Compressed image, adjustable quality',
    extension: '.jpg',
    icon: '📸',
    mimeType: 'image/jpeg',
    supportsQuality: true,
    supportsDpi: true,
    supportsPageRange: true,
  },
  {
    id: 'svg',
    label: 'SVG Vector',
    description: 'High-fidelity embedded raster in vector shell',
    extension: '.svg',
    icon: '✏️',
    mimeType: 'image/svg+xml',
    supportsQuality: false,
    supportsDpi: false,
    supportsPageRange: true,
  },
  {
    id: 'txt',
    label: 'Plain Text',
    description: 'Raw text content, no formatting',
    extension: '.txt',
    icon: '📃',
    mimeType: 'text/plain',
    supportsQuality: false,
    supportsDpi: false,
    supportsPageRange: true,
  },
];

export interface ExportOptions {
  format: ExportFormat;
  pages: number[] | null;
  dpi: number;
  quality: number;
  title: string;
}

export interface ExportResult {
  blob: Blob;
  filename: string;
  mimeType: string;
}

export interface SizeEstimation {
  currentSizeBytes: number;
  minAchievableBytes: number;
  estimatedBytes: number;
  textContentBytes: number;
  imageContentBytes: number;
  metadataBytes: number;
  imageCount: number;
  pageCount: number;
  zone: 'green' | 'yellow' | 'red';
  message: string;
}

// ─── Image Export (PNG/JPEG) ────────────────────────────────────────────────────

export async function exportPageToImage(
  doc: PDFDocumentData,
  pageIndex: number,
  engine: typeof import('@/engine'),
  format: 'png' | 'jpeg' = 'png',
  dpi: number = 150,
  quality: number = 0.92,
): Promise<Blob> {
  const page = doc.pages[pageIndex];
  if (!page) throw new Error(`Page ${pageIndex} not found`);

  const scale = dpi / 72;

  const mediaBox = page.mediaBox;
  const pageWidth = mediaBox.width;
  const pageHeight = mediaBox.height;

  // Use engine.renderPage which returns a RenderResult with a canvas
  const result = await engine.renderPage(doc, pageIndex, { scale });
  const canvas = result.canvas;

  return new Promise<Blob>((resolve, reject) => {
    const mimeType = format === 'jpeg' ? 'image/jpeg' : 'image/png';
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error('Canvas toBlob failed')),
      mimeType,
      format === 'jpeg' ? quality : undefined,
    );
  });
}

export async function exportToImages(
  doc: PDFDocumentData,
  engine: typeof import('@/engine'),
  options: ExportOptions,
  onProgress?: (current: number, total: number) => void,
): Promise<ExportResult> {
  const pages = options.pages ?? Array.from({ length: doc.pages.length }, (_, i) => i);
  const format = options.format as 'png' | 'jpeg';

  if (pages.length === 1) {
    const blob = await exportPageToImage(doc, pages[0], engine, format, options.dpi, options.quality);
    onProgress?.(1, 1);
    return {
      blob,
      filename: `${options.title}_page${pages[0] + 1}.${format === 'jpeg' ? 'jpg' : 'png'}`,
      mimeType: blob.type,
    };
  }

  const entries: ZipEntry[] = [];
  for (let i = 0; i < pages.length; i++) {
    const blob = await exportPageToImage(doc, pages[i], engine, format, options.dpi, options.quality);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    entries.push({
      name: `page_${String(pages[i] + 1).padStart(3, '0')}.${format === 'jpeg' ? 'jpg' : 'png'}`,
      data: bytes,
    });
    onProgress?.(i + 1, pages.length);
  }

  return {
    blob: buildZip(entries),
    filename: `${options.title}_images.zip`,
    mimeType: 'application/zip',
  };
}

// ─── SVG Export ─────────────────────────────────────────────────────────────────

export async function exportPageToSVG(
  doc: PDFDocumentData,
  pageIndex: number,
  engine: typeof import('@/engine'),
): Promise<string> {
  const page = doc.pages[pageIndex];
  if (!page) throw new Error(`Page ${pageIndex} not found`);

  const scale = 2;
  const mediaBox = page.mediaBox;
  const pageWidth = mediaBox.width;
  const pageHeight = mediaBox.height;

  // Use engine.renderPage which returns a RenderResult with a canvas
  const result = await engine.renderPage(doc, pageIndex, { scale });
  const canvas = result.canvas;

  const dataUrl = canvas.toDataURL('image/png');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${pageWidth}" height="${pageHeight}" viewBox="0 0 ${pageWidth} ${pageHeight}">
  <title>Page ${pageIndex + 1}</title>
  <image width="${pageWidth}" height="${pageHeight}" xlink:href="${dataUrl}" />
</svg>`;
}

export async function exportToSVG(
  doc: PDFDocumentData,
  engine: typeof import('@/engine'),
  options: ExportOptions,
  onProgress?: (current: number, total: number) => void,
): Promise<ExportResult> {
  const pages = options.pages ?? Array.from({ length: doc.pages.length }, (_, i) => i);

  if (pages.length === 1) {
    const svg = await exportPageToSVG(doc, pages[0], engine);
    onProgress?.(1, 1);
    return {
      blob: new Blob([svg], { type: 'image/svg+xml' }),
      filename: `${options.title}_page${pages[0] + 1}.svg`,
      mimeType: 'image/svg+xml',
    };
  }

  const entries: ZipEntry[] = [];
  for (let i = 0; i < pages.length; i++) {
    const svg = await exportPageToSVG(doc, pages[i], engine);
    entries.push({
      name: `page_${String(pages[i] + 1).padStart(3, '0')}.svg`,
      data: new TextEncoder().encode(svg),
    });
    onProgress?.(i + 1, pages.length);
  }

  return {
    blob: buildZip(entries),
    filename: `${options.title}_svg.zip`,
    mimeType: 'application/zip',
  };
}

// ─── Text-based Exports (HTML, Markdown, TXT) ──────────────────────────────────

function buildExportInput(
  doc: PDFDocumentData,
  pageIndex: number,
  engine: typeof import('@/engine'),
): ExportPageInput {
  const page = doc.pages[pageIndex];
  const mediaBox = page.mediaBox;
  const pageWidth = mediaBox.width;
  const pageHeight = mediaBox.height;

  const contentBytes = engine.getPageContentBytes(page, doc.objects);
  const interpreted = engine.interpretPage(contentBytes, page, doc.objects);
  const flow = engine.buildDocumentFlow(interpreted.textRuns);

  const lines = flow.lines.map((line: TextLine) => ({
    text: line.text,
    x: line.x,
    y: line.y,
    width: line.width,
    height: line.height,
    fontSize: line.fontSize || line.runs[0]?.fontSize || 12,
    bold: line.runs[0]?.fontName?.toLowerCase().includes('bold') ?? false,
    italic: line.runs[0]?.fontName?.toLowerCase().includes('italic') ?? false,
  }));

  return {
    pageIndex,
    width: pageWidth,
    height: pageHeight,
    lines,
    title: doc.info?.title,
  };
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Absolute-positioned HTML for one page (visual fidelity). */
function linesToPositionedHtml(
  input: ExportPageInput,
  pageLabel: string,
): string {
  const items = input.lines
    .filter(l => l.text.trim().length > 0)
    .map(line => {
      // PDF y-up → CSS y-down
      const top = input.height - line.y - line.height;
      const fontWeight = line.bold ? 'bold' : 'normal';
      const fontStyle = line.italic ? 'italic' : 'normal';
      const size = Math.max(6, line.fontSize || 12);
      return `<div class="pdf-line" style="left:${line.x.toFixed(1)}px;top:${top.toFixed(1)}px;width:${Math.max(line.width, 4).toFixed(1)}px;font-size:${size.toFixed(1)}px;font-weight:${fontWeight};font-style:${fontStyle};line-height:1.15;">${escapeXml(line.text)}</div>`;
    })
    .join('\n');

  return `<section class="pdf-page" data-page="${pageLabel}" style="position:relative;width:${input.width}px;height:${input.height}px;margin:0 auto 2rem;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.12);overflow:hidden;">
${items}
</section>`;
}

async function renderPageDataUrl(
  doc: PDFDocumentData,
  pageIndex: number,
  engine: typeof import('@/engine'),
  dpi: number = 120,
): Promise<string | null> {
  try {
    const scale = dpi / 72;
    const result = await engine.renderPage(doc, pageIndex, { scale });
    return result.canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}

export async function exportToHTML(
  doc: PDFDocumentData,
  engine: typeof import('@/engine'),
  options: ExportOptions,
  onProgress?: (current: number, total: number) => void,
): Promise<ExportResult> {
  try {
    const { assembledPages } = await engine.exportToStructure(doc, {
      title: options.title,
      pages: options.pages ?? undefined,
      onProgress,
    });

    const extracted = {
      title: options.title,
      pages: assembledPages,
    };

    // Exact layout (absolute CSS) — same idea as iLovePDF "Exact Layout"
    let html = engine.structureToHTML(extracted, 'exact');

    // If structure produced almost no content, fall back to raster pages
    const textish = assembledPages.reduce((n, p) => {
      return n + p.blocks.filter(b => b.type !== 'image').length;
    }, 0);

    if (textish === 0 && assembledPages.every(p => p.blocks.length === 0)) {
      const sections: string[] = [];
      const pages = options.pages ?? Array.from({ length: doc.pages.length }, (_, i) => i);
      for (let i = 0; i < pages.length; i++) {
        const dataUrl = await renderPageDataUrl(doc, pages[i], engine, Math.min(options.dpi || 120, 150));
        const label = String(pages[i] + 1);
        if (dataUrl) {
          const page = doc.pages[pages[i]];
          sections.push(`<section class="pdf-page" data-page="${label}" style="margin:0 auto 2rem;text-align:center;">
<img src="${dataUrl}" alt="Page ${label}" width="${page.mediaBox.width}" style="max-width:100%;height:auto;" />
</section>`);
        }
        onProgress?.(i + 1, pages.length);
      }
      html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeXml(options.title)}</title></head>
<body style="margin:0;padding:1.5rem;background:#f4f4f5;">${sections.join('\n')}</body></html>`;
    }

    return {
      blob: new Blob([html], { type: 'text/html;charset=utf-8' }),
      filename: `${options.title}.html`,
      mimeType: 'text/html',
    };
  } catch (err) {
    console.error('[Export HTML] Structure export failed, using plain fallback:', err);
    // Last-resort: plain text wrapped in HTML
    const pages = options.pages ?? Array.from({ length: doc.pages.length }, (_, i) => i);
    const parts: string[] = [];
    for (let i = 0; i < pages.length; i++) {
      const plain = engine.extractPagePlainText(doc, pages[i]);
      parts.push(`<section><h2>Page ${pages[i] + 1}</h2><pre style="white-space:pre-wrap;">${escapeXml(plain)}</pre></section>`);
      onProgress?.(i + 1, pages.length);
    }
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeXml(options.title)}</title></head><body>${parts.join('\n')}</body></html>`;
    return {
      blob: new Blob([html], { type: 'text/html;charset=utf-8' }),
      filename: `${options.title}.html`,
      mimeType: 'text/html',
    };
  }
}

export async function exportToMarkdown(
  doc: PDFDocumentData,
  engine: typeof import('@/engine'),
  options: ExportOptions,
  onProgress?: (current: number, total: number) => void,
): Promise<ExportResult> {
  try {
    const { assembledPages } = await engine.exportToStructure(doc, {
      title: options.title,
      pages: options.pages ?? undefined,
      onProgress,
    });

    const extracted = {
      title: options.title,
      pages: assembledPages,
    };

    let md = engine.structureToMarkdown(extracted);

    // Empty structure → plain text fallback
    if (!md.trim() || md.trim().length < 5) {
      const pages = options.pages ?? Array.from({ length: doc.pages.length }, (_, i) => i);
      const parts: string[] = options.title ? [`# ${options.title}`, ''] : [];
      for (let i = 0; i < pages.length; i++) {
        const plain = engine.extractPagePlainText(doc, pages[i]).trim();
        if (pages.length > 1) parts.push(`## Page ${pages[i] + 1}`, '');
        parts.push(plain || `*(Page ${pages[i] + 1}: no extractable text)*`, '');
        onProgress?.(i + 1, pages.length);
      }
      md = parts.join('\n').trimEnd() + '\n';
    }

    return {
      blob: new Blob([md], { type: 'text/markdown;charset=utf-8' }),
      filename: `${options.title}.md`,
      mimeType: 'text/markdown',
    };
  } catch (err) {
    console.error('[Export Markdown] Structure export failed:', err);
    const pages = options.pages ?? Array.from({ length: doc.pages.length }, (_, i) => i);
    const parts: string[] = options.title ? [`# ${options.title}`, ''] : [];
    for (let i = 0; i < pages.length; i++) {
      const plain = engine.extractPagePlainText(doc, pages[i]).trim();
      if (pages.length > 1) parts.push(`## Page ${pages[i] + 1}`, '');
      parts.push(plain || `*(Page ${pages[i] + 1}: export failed)*`, '');
      onProgress?.(i + 1, pages.length);
    }
    return {
      blob: new Blob([parts.join('\n').trimEnd() + '\n'], { type: 'text/markdown;charset=utf-8' }),
      filename: `${options.title}.md`,
      mimeType: 'text/markdown',
    };
  }
}

export async function exportToPlainText(
  doc: PDFDocumentData,
  engine: typeof import('@/engine'),
  options: ExportOptions,
  onProgress?: (current: number, total: number) => void,
): Promise<ExportResult> {
  const pages = options.pages ?? Array.from({ length: doc.pages.length }, (_, i) => i);
  const parts: string[] = [];

  for (let i = 0; i < pages.length; i++) {
    const text = engine.extractPagePlainText(doc, pages[i]);
    parts.push(text);
    onProgress?.(i + 1, pages.length);
  }

  return {
    blob: new Blob([parts.join('\n\n--- Page Break ---\n\n')], { type: 'text/plain' }),
    filename: `${options.title}.txt`,
    mimeType: 'text/plain',
  };
}

// ─── DOCX Export (via `docx` library with absolute positioning) ─────────────────
//
// Strategy (same as iLovePDF/Sejda "keep layout" mode):
// 1. Extract text lines + images from the PDF via the flow engine
// 2. For each page, render a background image of the full page
// 3. Place each text run as a Textbox with absolute positioning
//    (position, left, top, width, height) matching its PDF coordinates
// 4. This preserves the exact visual layout — fonts, positions, spacing
//
// We also render each page as a high-res background image embedded via
// ImageRun to preserve vector graphics, shapes, charts, and images.

/**
 * Convert PDF points to a CSS-like dimension string for the docx library.
 * The docx library's Textbox accepts LengthUnit which can be "Xpt".
 */
function ptUnit(pts: number): `${number}pt` {
  return `${Math.round(pts * 100) / 100}pt` as `${number}pt`;
}

/**
 * Render a full page to a PNG Uint8Array for embedding as background.
 */
async function renderPageToBytes(
  doc: PDFDocumentData,
  pageIndex: number,
  engine: typeof import('@/engine'),
  dpi: number = 150,
): Promise<{ data: Uint8Array; widthPx: number; heightPx: number }> {
  const page = doc.pages[pageIndex];
  const mediaBox = page.mediaBox;
  const pageWidth = mediaBox.width;
  const pageHeight = mediaBox.height;
  const scale = dpi / 72;

  // Use engine.renderPage which returns a RenderResult with a canvas
  const result = await engine.renderPage(doc, pageIndex, { scale });
  const canvas = result.canvas;

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => b ? resolve(b) : reject(new Error('toBlob failed')),
      'image/png',
    );
  });

  return {
    data: new Uint8Array(await blob.arrayBuffer()),
    widthPx: canvas.width,
    heightPx: canvas.height,
  };
}

/**
 * Detect font style flags from a run's fontName.
 */
function detectFontFlags(fontName: string): { bold: boolean; italic: boolean } {
  const lower = fontName.toLowerCase();
  return {
    bold: /bold|black|heavy|semibold|demibold/.test(lower),
    italic: /italic|oblique/.test(lower),
  };
}

/**
 * Extract a clean font family from a PDF font name (strip subset prefix, style suffixes).
 */
function cleanFontFamily(fontName: string): string {
  // Remove subset prefix like ABCDEF+
  let name = fontName.replace(/^[A-Z]{6}\+/, '');
  // Remove common style suffixes
  name = name.replace(/[-,](Bold|Italic|BoldItalic|Regular|Light|Medium|Thin|Heavy|Black|SemiBold|ExtraBold|Condensed|Oblique)$/i, '');
  // Remove hyphens that are separators
  name = name.replace(/-$/, '');
  return name || 'Calibri';
}

/**
 * Map a PDF color (r,g,b in 0-1) to a hex string.
 */
function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (v: number) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0');
  return `${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export async function exportToWord(
  doc: PDFDocumentData,
  engine: typeof import('@/engine'),
  options: ExportOptions,
  onProgress?: (current: number, total: number) => void,
): Promise<ExportResult> {
  const result = await engine.exportToDocx(doc, {
    title: options.title || 'Export',
    pages: options.pages ?? undefined,
    onProgress,
  });

  return {
    blob: result.blob,
    filename: result.filename,
    mimeType: result.mimeType,
  };
}

// ─── Master Export Function ─────────────────────────────────────────────────────

export async function exportDocument(
  doc: PDFDocumentData,
  engine: typeof import('@/engine'),
  options: ExportOptions,
  onProgress?: (current: number, total: number) => void,
): Promise<ExportResult> {
  switch (options.format) {
    case 'png':
    case 'jpeg':
      return exportToImages(doc, engine, options, onProgress);
    case 'svg':
      return exportToSVG(doc, engine, options, onProgress);
    case 'html':
      return exportToHTML(doc, engine, options, onProgress);
    case 'markdown':
      return exportToMarkdown(doc, engine, options, onProgress);
    case 'txt':
      return exportToPlainText(doc, engine, options, onProgress);
    case 'docx':
      return exportToWord(doc, engine, options, onProgress);
    default:
      throw new Error(`Unsupported export format: ${options.format}`);
  }
}

// ─── File Size Estimation ───────────────────────────────────────────────────────

export function estimateDocumentSize(doc: PDFDocumentData): SizeEstimation {
  const currentSizeBytes = doc.rawBytes?.length ?? 0;
  const pageCount = doc.pages.length;

  let imageCount = 0;
  let imageContentBytes = 0;

  for (const [, obj] of doc.objects) {
    if (obj && typeof obj === 'object' && 'rawBytes' in obj) {
      const stream = obj as {
        rawBytes?: Uint8Array;
        dict?: { getName?: (k: string) => string | undefined };
      };
      const bytes = stream.rawBytes?.length ?? 0;
      const subtype = stream.dict?.getName?.('Subtype');
      if (subtype === 'Image') {
        imageCount++;
        imageContentBytes += bytes;
      }
    }
  }

  const textContentBytes = Math.max(0, currentSizeBytes - imageContentBytes);
  const metadataBytes = Math.max(1024, pageCount * 256);

  // Honest floor:
  // - No images → almost nothing to reclaim (fonts/structure stay). ~95% of current.
  // - With images → images can shrink a lot; text/structure still need ~70% of non-image bytes.
  let minAchievableBytes: number;
  if (imageCount === 0 || imageContentBytes === 0) {
    minAchievableBytes = Math.max(
      Math.round(currentSizeBytes * 0.95),
      metadataBytes,
      2048,
    );
  } else {
    const minImageBytes = Math.max(imageCount * 1500, Math.round(imageContentBytes * 0.08));
    const minTextBytes = Math.round(textContentBytes * 0.7);
    minAchievableBytes = Math.max(metadataBytes + minTextBytes + minImageBytes, 2048);
    // Never claim below ~40% of current even for image-heavy files
    minAchievableBytes = Math.max(minAchievableBytes, Math.round(currentSizeBytes * 0.15));
  }

  // Clamp: min cannot exceed current
  if (currentSizeBytes > 0) {
    minAchievableBytes = Math.min(minAchievableBytes, currentSizeBytes);
  }

  return {
    currentSizeBytes,
    minAchievableBytes,
    estimatedBytes: currentSizeBytes,
    textContentBytes,
    imageContentBytes,
    metadataBytes,
    imageCount,
    pageCount,
    zone: 'green',
    message: '',
  };
}

export function evaluateTargetSize(
  estimation: SizeEstimation,
  targetBytes: number,
): SizeEstimation {
  const { currentSizeBytes, minAchievableBytes, imageCount } = estimation;

  let zone: 'green' | 'yellow' | 'red';
  let message: string;

  if (targetBytes >= currentSizeBytes) {
    zone = 'green';
    message = 'Target is at or above the current size — file will be saved as-is (light optimize only).';
  } else if (targetBytes < minAchievableBytes) {
    zone = 'red';
    message =
      imageCount === 0
        ? `Not achievable. This PDF has no compressible images (current ${formatFileSize(currentSizeBytes)}). Minimum realistic size ≈ ${formatFileSize(minAchievableBytes)}.`
        : `Not achievable. Minimum realistic size with heavy image compression ≈ ${formatFileSize(minAchievableBytes)}.`;
  } else if (imageCount === 0) {
    // Text-only: only a tiny shrink is ever green/yellow
    zone = 'yellow';
    message = `Limited savings possible (text/fonts). Best case ≈ ${formatFileSize(minAchievableBytes)} — will not rasterize pages (that would make the file larger).`;
  } else if (targetBytes >= currentSizeBytes * 0.55) {
    zone = 'green';
    message = 'Achievable by recompressing embedded images.';
  } else {
    zone = 'yellow';
    message = `Achievable with heavy image quality reduction (${imageCount} image${imageCount > 1 ? 's' : ''}).`;
  }

  return {
    ...estimation,
    estimatedBytes: Math.max(targetBytes, minAchievableBytes),
    zone,
    message,
  };
}

// ─── Utility: Format File Size ──────────────────────────────────────────────────

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function parseFileSize(input: string): number | null {
  const match = input.trim().match(/^([\d.]+)\s*(b|kb|mb|gb)?$/i);
  if (!match) return null;
  const value = parseFloat(match[1]);
  if (isNaN(value) || value <= 0) return null;
  const unit = (match[2] || 'b').toLowerCase();
  switch (unit) {
    case 'b': return Math.round(value);
    case 'kb': return Math.round(value * 1024);
    case 'mb': return Math.round(value * 1024 * 1024);
    case 'gb': return Math.round(value * 1024 * 1024 * 1024);
    default: return Math.round(value);
  }
}

// ─── Minimal ZIP Builder (no dependencies) ──────────────────────────────────────

interface ZipEntry {
  name: string;
  data: Uint8Array;
}

function buildZip(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const centralDir: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes = enc.encode(entry.name);
    const data = entry.data;
    const crc = crc32(data);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lhView = new DataView(localHeader.buffer);
    lhView.setUint32(0, 0x04034b50, true);
    lhView.setUint16(4, 20, true);
    lhView.setUint16(6, 0, true);
    lhView.setUint16(8, 0, true);
    lhView.setUint16(10, 0, true);
    lhView.setUint16(12, 0, true);
    lhView.setUint32(14, crc, true);
    lhView.setUint32(18, data.length, true);
    lhView.setUint32(22, data.length, true);
    lhView.setUint16(26, nameBytes.length, true);
    lhView.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);

    const cdHeader = new Uint8Array(46 + nameBytes.length);
    const cdView = new DataView(cdHeader.buffer);
    cdView.setUint32(0, 0x02014b50, true);
    cdView.setUint16(4, 20, true);
    cdView.setUint16(6, 20, true);
    cdView.setUint16(8, 0, true);
    cdView.setUint16(10, 0, true);
    cdView.setUint16(12, 0, true);
    cdView.setUint16(14, 0, true);
    cdView.setUint32(16, crc, true);
    cdView.setUint32(20, data.length, true);
    cdView.setUint32(24, data.length, true);
    cdView.setUint16(28, nameBytes.length, true);
    cdView.setUint16(30, 0, true);
    cdView.setUint16(32, 0, true);
    cdView.setUint16(34, 0, true);
    cdView.setUint16(36, 0, true);
    cdView.setUint32(38, 0, true);
    cdView.setUint32(42, offset, true);
    cdHeader.set(nameBytes, 46);

    parts.push(localHeader);
    parts.push(data);
    centralDir.push(cdHeader);

    offset += localHeader.length + data.length;
  }

  const cdOffset = offset;
  let cdSize = 0;
  for (const cd of centralDir) {
    parts.push(cd);
    cdSize += cd.length;
  }

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, 0x06054b50, true);
  eocdView.setUint16(4, 0, true);
  eocdView.setUint16(6, 0, true);
  eocdView.setUint16(8, entries.length, true);
  eocdView.setUint16(10, entries.length, true);
  eocdView.setUint32(12, cdSize, true);
  eocdView.setUint32(16, cdOffset, true);
  eocdView.setUint16(20, 0, true);
  parts.push(eocd);

  return new Blob(parts as BlobPart[], { type: 'application/zip' });
}

function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
