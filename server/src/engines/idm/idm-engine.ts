import type { IIntermediateDocumentEngine } from '../common/interfaces.js';
import type { LayoutDocument } from '../layout/types.js';
import type { RawDocument } from '../parser/raw-model.js';
import { reconstructDocument } from './reconstruction.js';
import { createEmptyDocument, type IntermediateDocument } from './types.js';
import { createId } from '../../utils/id.js';

/**
 * Phase 4 — Intermediate Document Model Reconstruction Engine.
 *
 * LayoutDocument (+ RawDocument for resources) → IntermediateDocument.
 * Exporters must consume only the IDM.
 */
export class IntermediateDocumentEngine implements IIntermediateDocumentEngine {
  readonly name = 'IntermediateDocumentEngine' as const;

  async build(
    raw: RawDocument,
    layout?: LayoutDocument | null,
  ): Promise<IntermediateDocument> {
    if (!layout) {
      // Degenerate path: empty shells when layout is unavailable
      return createShell(raw);
    }
    return reconstructDocument(layout, raw);
  }
}

function createShell(raw: RawDocument): IntermediateDocument {
  const doc = createEmptyDocument(createId('idm'), raw.pages.length, {
    title: raw.metadata.title,
    author: raw.metadata.author,
    subject: raw.metadata.subject,
    creator: raw.metadata.creator,
    producer: raw.metadata.producer,
    creationDate: raw.metadata.creationDate,
    modificationDate: raw.metadata.modificationDate,
    keywords: raw.metadata.keywords,
    pageCount: raw.pages.length,
  });

  const sectionId = createId('section');
  doc.sections = [
    {
      id: sectionId,
      parentId: doc.id,
      childIds: [],
      previousId: null,
      nextId: null,
      pageIndex: 0,
      sectionId,
      readingOrderIndex: 0,
      logicalOrderIndex: 0,
      styleCandidates: [],
      pages: raw.pages.map((page, i) => ({
        id: createId('page'),
        parentId: sectionId,
        childIds: [],
        previousId: null,
        nextId: null,
        pageIndex: page.index,
        sectionId,
        readingOrderIndex: i,
        logicalOrderIndex: i,
        styleCandidates: [],
        index: page.index,
        width: page.width,
        height: page.height,
        blocks: [],
        headers: [],
        footers: [],
      })),
    },
  ];
  doc.sections[0]!.childIds = doc.sections[0]!.pages.map((p) => p.id);
  doc.bookmarks = raw.bookmarks.map((b) => ({
    id: b.id,
    title: b.title,
    pageIndex: b.pageIndex,
    children: b.children?.map((c) => ({
      id: c.id,
      title: c.title,
      pageIndex: c.pageIndex,
    })),
  }));
  doc.sourceRawId = raw.id;
  return doc;
}
