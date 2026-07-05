/**
 * PDF Engine — Public API
 *
 * This is the main entry point for the PDF engine.
 * Import from '@/engine' to access all parsing, rendering, and editing capabilities.
 */

// ── Core types ──
export {
  PDFName,
  PDFString,
  PDFHexString,
  PDFNumber,
  PDFBoolean,
  PDFNull,
  PDFRef,
  PDFArray,
  PDFDict,
  PDFStream,
} from './types';

export type {
  PDFObject,
  XRefEntry,
  XRefTable,
  PDFRectangle,
  PDFPageInfo,
  PDFDocumentInfo,
  PDFDocumentData,
} from './types';

// ── Parser ──
export { parsePDF, resolveRef, deepResolve, getPageContentBytes, getResource } from './parser/parser';
export { PDFLexer, TokenType } from './parser/lexer';
export type { Token } from './parser/lexer';
export { applyFilters, flateEncode } from './parser/filters';

// ── Content Stream ──
export { parseContentStream } from './content/operator-lexer';
export type { CSInstruction } from './content/operator-lexer';
export { interpretPage } from './content/interpreter';
export type {
  TextRun,
  GlyphPosition,
  PathItem,
  PathSegment,
  ImageItem,
  DisplayItem,
  InterpreterResult,
  GraphicsState,
  Matrix,
  FontInfo,
} from './content/interpreter';

// ── Fonts ──
export { loadPageFonts, loadFont, charCodeToUnicode } from './fonts/font-parser';
export type { FontData } from './fonts/font-parser';
export { getStandardFont, getCSSFontFamily, getStandardFontCharWidth } from './fonts/standard14';
export type { StandardFontMetrics } from './fonts/standard14';
export { parseCMap, getCodeBytes } from './fonts/cmap-parser';
export type { CMapData } from './fonts/cmap-parser';
export { parseTTF, getGlyphOutline, charCodeToGlyphId, getGlyphWidth } from './fonts/truetype-parser';
export type { TTFFont, GlyphOutline, GlyphCommand } from './fonts/truetype-parser';

// ── Renderer ──
export { renderPage, renderPageToCanvas, renderPDFPage, renderAllPages } from './render/renderer';
export type { RenderOptions, RenderResult } from './render/renderer';
export { parseColorSpace, cmykToRGB, rgbToCSSColor, componentsToCSSColor } from './render/color-space';
export type { ColorSpace, RGBColor } from './render/color-space';
export { decodeImage } from './render/image-decoder';
export type { DecodedImage } from './render/image-decoder';

// ── Editor ──
export { applyTextEdits, findTextInPage, findAndReplace, insertTextRun } from './editor/text-editor';
export { insertImageRun } from './editor/image-editor';
export type { TextEdit, EditResult } from './editor/text-editor';
export {
  compileContentStream,
  updatePageContent,
  serializeObject,
  serializeToString,
  serializeIndirectObject,
  concatBytes,
} from './editor/stream-compiler';
export {
  createAnnotationDict,
  addAnnotationToPage,
  removeAnnotationFromPage,
  pdfDateString,
} from './editor/annotation-engine';
export type {
  AnnotationBase,
  HighlightAnnotation,
  FreeTextAnnotation,
  InkAnnotation,
  StampAnnotation,
  RedactAnnotation,
  LinkAnnotation,
  Annotation,
} from './editor/annotation-engine';

// ── Writer ──
export { serializeDocument, getNextObjNum } from './writer/serializer';
export { saveIncremental } from './writer/incremental-writer';
export {
  deletePage,
  deletePages,
  reorderPages,
  movePage,
  rotatePage,
  rotatePageBy,
  insertBlankPage,
  extractPages,
  insertPagesFromDocument,
} from './writer/page-operations';

// ── Watermark ──
export {
  buildTextWatermarkContent,
  buildImageWatermarkContent,
  buildPatternWatermarkContent,
  createOpacityExtGState,
  createWatermarkImageXObject,
  applyWatermarkToPage,
  applyWatermarks,
} from './watermark/watermark-engine';
export type {
  WatermarkType,
  WatermarkBase,
  TextWatermark,
  ImageWatermark,
  PatternWatermark,
  WatermarkPosition,
  Watermark,
} from './watermark/watermark-engine';

export { detectWatermarks, detectWatermarksOnPage } from './watermark/watermark-detector';
export type { DetectedWatermark, DetectionOptions } from './watermark/watermark-detector';

export {
  removeWatermarks,
  removeWatermarksFromPage,
  detectAndRemoveAllWatermarks,
} from './watermark/watermark-remover';
export type { RemovalResult, BatchRemovalResult } from './watermark/watermark-remover';
