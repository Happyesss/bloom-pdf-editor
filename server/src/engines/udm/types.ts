import type { GraphicsModel } from '../graphics/types.js';
import type { IntermediateDocument } from '../idm/types.js';
import type { RecognitionDocument } from '../ocr/types.js';
import type { SemanticDocument } from '../semantic/types.js';
import type { DocumentStructureModel } from '../structure/types.js';
import type { LogicalTable } from '../table/types.js';
import type { TypographyAnalysis } from '../typography/types.js';

/**
 * Phase 11 — Unified Document Model.
 * Sole input to exporters. Never contains raw PDF parser objects.
 */
export interface UnifiedDocumentModel {
  id: string;
  version: '1.0';
  metadata: {
    title?: string;
    author?: string;
    subject?: string;
    keywords?: string[];
    language?: string;
    pageCount: number;
    createdAt: string;
  };
  /** Editable content tree for exporters. */
  idm: IntermediateDocument;
  semantic: SemanticDocument;
  tables: LogicalTable[];
  graphics: GraphicsModel | null;
  structure: DocumentStructureModel | null;
  recognition: RecognitionDocument | null;
  typography: TypographyAnalysis | null;
  /**
   * Extracted image bytes keyed by resource ID (originalResourceId / resourceKey).
   * Populated during conversion pipeline; exporters use this to embed real images.
   * Omitted when not available (client-side, tests without images).
   */
  imageStore?: Map<string, { data: Uint8Array; mimeType: string; widthPx: number; heightPx: number }>;
}
