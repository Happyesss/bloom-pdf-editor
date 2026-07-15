import { createId } from '../../utils/id.js';
import type { Bookmark } from '../idm/types.js';
import type { RawBookmark } from '../parser/raw-model.js';
import type { IBookmarkBuilder, StructureEngineInput } from './algorithms/types.js';
import type { BookmarkNode } from './types.js';

/**
 * Build bookmark / outline graph from IDM or raw PDF outline.
 */
export class BookmarkBuilder implements IBookmarkBuilder {
  readonly name = 'BookmarkBuilder';

  build(input: StructureEngineInput): BookmarkNode[] {
    if (input.idm.bookmarks.length) {
      return input.idm.bookmarks.map((b) => fromIdm(b));
    }
    if (input.raw.bookmarks.length) {
      return input.raw.bookmarks.map((b) => fromRaw(b));
    }

    // Synthesize shallow outline from top-level headings
    const headings = Object.values(input.semantic.nodes)
      .filter((n) => n.type === 'heading' || n.type === 'title')
      .sort((a, b) => a.readingOrderIndex - b.readingOrderIndex);

    return headings.slice(0, 40).map((h) => ({
      id: createId('bm'),
      title: 'text' in h ? String(h.text ?? 'Untitled') : 'Untitled',
      pageIndex: h.pageIndex,
      children: [],
      sourceId: h.id,
      confidence: 0.55,
    }));
  }
}

function fromIdm(b: Bookmark): BookmarkNode {
  return {
    id: b.id,
    title: b.title,
    pageIndex: b.pageIndex,
    children: (b.children ?? []).map(fromIdm),
    sourceId: b.id,
    confidence: 0.95,
  };
}

function fromRaw(b: RawBookmark): BookmarkNode {
  return {
    id: b.id || createId('bm'),
    title: b.title,
    pageIndex: b.pageIndex,
    children: (b.children ?? []).map(fromRaw),
    sourceId: b.id,
    confidence: 0.9,
  };
}
