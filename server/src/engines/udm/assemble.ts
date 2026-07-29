import { createId } from '../../utils/id.js';
import type { GraphicsModel } from '../graphics/types.js';
import type { IntermediateDocument } from '../idm/types.js';
import type { RecognitionDocument } from '../ocr/types.js';
import type { SemanticDocument } from '../semantic/types.js';
import type { DocumentStructureModel } from '../structure/types.js';
import type { LogicalTable } from '../table/types.js';
import type { TypographyAnalysis } from '../typography/types.js';
import type { UnifiedDocumentModel } from './types.js';

export interface AssembleUdmInput {
  idm: IntermediateDocument;
  semantic: SemanticDocument;
  tables?: LogicalTable[];
  graphics?: GraphicsModel | null;
  structure?: DocumentStructureModel | null;
  recognition?: RecognitionDocument | null;
  typography?: TypographyAnalysis | null;
  /** Extracted image bytes keyed by resource ID. */
  imageStore?: Map<string, { data: Uint8Array; mimeType: string; widthPx: number; heightPx: number }>;
}

/** Assemble format-independent UDM for exporters (no PDF objects). */
export function assembleUnifiedDocument(input: AssembleUdmInput): UnifiedDocumentModel {
  const meta = input.structure?.metadata ?? {};
  const idmMeta = input.idm.metadata;

  return {
    id: createId('udm'),
    version: '1.0',
    metadata: {
      title: meta.title ?? idmMeta.title ?? input.semantic.title,
      author: meta.author ?? idmMeta.author,
      subject: meta.subject ?? idmMeta.subject,
      keywords: meta.keywords ?? idmMeta.keywords,
      language:
        meta.language ?? idmMeta.language ?? input.recognition?.primaryLanguage,
      pageCount: idmMeta.pageCount,
      createdAt: new Date().toISOString(),
    },
    idm: input.idm,
    semantic: input.semantic,
    tables: input.tables ?? [],
    graphics: input.graphics ?? null,
    structure: input.structure ?? null,
    recognition: input.recognition ?? null,
    typography: input.typography ?? null,
    imageStore: input.imageStore,
  };
}

