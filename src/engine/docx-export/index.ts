import type { PDFDocumentData } from '../types';
import { extractGlyphs } from './glyph-extraction';
import { groupIntoLines } from './grouping';
import { detectStructure } from './structure-detect';
import { extractImages } from './image-extraction';
import { assemblePage, assembleDocument } from './document-assembly';
import { serializeToDocx } from './docx-serializer';

export interface DocxExportOptions {
  title?: string;
  pages?: number[];
  onProgress?: (current: number, total: number) => void;
}

export interface DocxExportResult {
  blob: Blob;
  filename: string;
  mimeType: string;
}

export async function exportToDocx(
  doc: PDFDocumentData,
  options: DocxExportOptions = {}
): Promise<DocxExportResult> {
  const pageIndices = options.pages ?? Array.from({ length: doc.pages.length }, (_, i) => i);
  const total = pageIndices.length;
  const assembledPages = [];

  for (let i = 0; i < total; i++) {
    const pageIndex = pageIndices[i];
    const pageInfo = doc.pages[pageIndex];

    // Phase 1: Extract Glyphs
    const pageData = extractGlyphs(pageInfo, doc.objects);
    
    // Phase 2, 4: Group into Lines and columns
    const lines = groupIntoLines(pageData);
    
    // Phase 3, 6, 7: Detect Structure (Paragraphs, Headings, Lists, Tables)
    const textBlocks = detectStructure(pageData, lines);
    
    // Phase 5: Image Extraction
    const imageBlocks = await extractImages(pageData, pageInfo, doc.objects);
    
    // Phase 8: Page Assembly
    const assembledPage = assemblePage(
      pageIndex, 
      pageInfo.mediaBox.width, 
      pageInfo.mediaBox.height, 
      textBlocks, 
      imageBlocks
    );
    assembledPages.push(assembledPage);
    
    options.onProgress?.(i + 1, total);
  }

  // Phase 8: Document Assembly
  const document = assembleDocument(assembledPages, options.title);
  
  // Phase 9: Serialization
  const blob = await serializeToDocx(document);

  return {
    blob,
    filename: `${options.title || 'Export'}.docx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}

export async function exportToStructure(
  doc: PDFDocumentData,
  options: DocxExportOptions = {}
) {
  const pageIndices = options.pages ?? Array.from({ length: doc.pages.length }, (_, i) => i);
  const total = pageIndices.length;
  const assembledPages = [];

  for (let i = 0; i < total; i++) {
    const pageIndex = pageIndices[i];
    const pageInfo = doc.pages[pageIndex];

    const pageData = extractGlyphs(pageInfo, doc.objects);
    const lines = groupIntoLines(pageData);
    const textBlocks = detectStructure(pageData, lines);
    const imageBlocks = await extractImages(pageData, pageInfo, doc.objects);
    
    const assembledPage = assemblePage(
      pageIndex, 
      pageInfo.mediaBox.width, 
      pageInfo.mediaBox.height, 
      textBlocks, 
      imageBlocks
    );
    assembledPages.push(assembledPage);
  }

  return { assembledPages };
}

export * from './types';
