import type {
  Block,
  IntermediateDocument,
  Page,
  Run,
  Section,
} from './types.js';
import { deserializeIdm, serializeIdmBinary, serializeIdmJson } from './serialize.js';

export type TraverseVisitor = (node: {
  kind: string;
  id: string;
  node: unknown;
}) => void | false;

/**
 * Document API for IDM — Load / Save / Traverse / Find / Search.
 * Operates only on IntermediateDocument (no PDF knowledge).
 */
export class IdmDocumentApi {
  constructor(private doc: IntermediateDocument) {}

  static loadDocument(bytes: Uint8Array, format: 'json' | 'binary' = 'json'): IdmDocumentApi {
    return new IdmDocumentApi(deserializeIdm(bytes, format));
  }

  saveDocument(format: 'json' | 'binary' | 'compressed' = 'json'): Uint8Array {
    if (format === 'binary' || format === 'compressed') {
      return serializeIdmBinary(this.doc, format === 'compressed');
    }
    return serializeIdmJson(this.doc);
  }

  getDocument(): IntermediateDocument {
    return this.doc;
  }

  findNode(id: string): unknown | null {
    const ref = this.doc.nodeIndex[id];
    if (!ref) return null;
    return this.resolveRef(ref.kind, id);
  }

  findParent(id: string): unknown | null {
    const node = this.findNode(id) as { parentId?: string | null } | null;
    if (!node?.parentId) return null;
    return this.findNode(node.parentId);
  }

  findChildren(id: string): unknown[] {
    const node = this.findNode(id) as { childIds?: string[] } | null;
    if (!node?.childIds) return [];
    return node.childIds
      .map((cid) => this.findNode(cid))
      .filter((n): n is NonNullable<typeof n> => n != null);
  }

  traverse(visitor: TraverseVisitor): void {
    for (const section of this.doc.sections) {
      if (visitor({ kind: 'section', id: section.id, node: section }) === false) return;
      for (const page of section.pages) {
        if (visitor({ kind: 'page', id: page.id, node: page }) === false) return;
        for (const block of page.blocks) {
          if (visitor({ kind: 'block', id: block.id, node: block }) === false) return;
          if ('runs' in block) {
            for (const run of block.runs) {
              if (visitor({ kind: 'run', id: run.id, node: run }) === false) return;
            }
          }
        }
      }
    }
  }

  search(query: string): Array<{ blockId: string; pageIndex: number; snippet: string }> {
    const q = query.toLowerCase();
    const hits: Array<{ blockId: string; pageIndex: number; snippet: string }> = [];

    this.traverse(({ kind, node }) => {
      if (kind !== 'block') return;
      const block = node as Block;
      if (!('runs' in block)) return;
      const text = block.runs.map((r: Run) => r.text).join('');
      if (text.toLowerCase().includes(q)) {
        hits.push({
          blockId: block.id,
          pageIndex: block.pageIndex,
          snippet: text.slice(0, 160),
        });
      }
    });

    return hits;
  }

  private resolveRef(kind: string, id: string): unknown | null {
    for (const section of this.doc.sections) {
      if (kind === 'section' && section.id === id) return section;
      for (const page of section.pages) {
        if (kind === 'page' && page.id === id) return page;
        const blocks = [
          ...page.blocks,
          ...page.headers.flatMap((h) => h.blocks),
          ...page.footers.flatMap((f) => f.blocks),
        ];
        for (const block of blocks) {
          if (kind === 'block' && block.id === id) return block;
          if ('runs' in block) {
            for (const run of block.runs) {
              if (kind === 'run' && run.id === id) return run;
            }
            for (const word of block.words) {
              if (kind === 'word' && word.id === id) return word;
            }
            for (const ch of block.characters) {
              if (kind === 'character' && ch.id === id) return ch;
            }
          }
        }
      }
    }
    if (kind === 'bookmark') return this.doc.bookmarks.find((b) => b.id === id) ?? null;
    if (kind === 'footnote') {
      return (
        this.doc.footnotes.find((f) => f.id === id) ??
        this.doc.endnotes.find((f) => f.id === id) ??
        null
      );
    }
    if (kind === 'hyperlink') return this.doc.hyperlinks.find((h) => h.id === id) ?? null;
    return null;
  }
}

/** Convenience free functions matching the Phase 4 API surface. */
export function LoadDocument(bytes: Uint8Array, format?: 'json' | 'binary'): IntermediateDocument {
  return IdmDocumentApi.loadDocument(bytes, format).getDocument();
}

export function SaveDocument(
  doc: IntermediateDocument,
  format: 'json' | 'binary' | 'compressed' = 'json',
): Uint8Array {
  return new IdmDocumentApi(doc).saveDocument(format);
}

export function Traverse(doc: IntermediateDocument, visitor: TraverseVisitor): void {
  new IdmDocumentApi(doc).traverse(visitor);
}

export function FindNode(doc: IntermediateDocument, id: string): unknown | null {
  return new IdmDocumentApi(doc).findNode(id);
}

export function FindChildren(doc: IntermediateDocument, id: string): unknown[] {
  return new IdmDocumentApi(doc).findChildren(id);
}

export function FindParent(doc: IntermediateDocument, id: string): unknown | null {
  return new IdmDocumentApi(doc).findParent(id);
}

export function Search(
  doc: IntermediateDocument,
  query: string,
): Array<{ blockId: string; pageIndex: number; snippet: string }> {
  return new IdmDocumentApi(doc).search(query);
}

export type { Section, Page, Block };
