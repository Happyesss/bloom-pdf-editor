/**
 * Local PDF → DOCX export (no cloud APIs / tokens).
 *
 * This now uses the standalone DOCX export engine located at src/engine/docx-export.
 */

import type { PDFDocumentData } from '@/engine';
import type * as Engine from '@/engine';

export interface FlowDocxOptions {
  title: string;
  pages: number[] | null;
}

export interface FlowDocxResult {
  blob: Blob;
  filename: string;
  mimeType: string;
}

/**
 * Export PDF pages to DOCX entirely in-browser (no API keys).
 */
export async function exportFlowDocx(
  doc: PDFDocumentData,
  engine: typeof Engine,
  options: FlowDocxOptions,
  onProgress?: (current: number, total: number) => void,
): Promise<FlowDocxResult> {
  // Call the new standalone engine
  const result = await engine.exportToDocx(doc, {
    title: options.title,
    pages: options.pages || undefined,
    onProgress,
  });

  return {
    blob: result.blob,
    filename: result.filename,
    mimeType: result.mimeType,
  };
}
