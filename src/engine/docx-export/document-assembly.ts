import type { ExtractedPage, ExtractedDocument, Block, ImageBlock } from './types';

export function assemblePage(
  pageIndex: number,
  width: number,
  height: number,
  textBlocks: Block[],
  imageBlocks: ImageBlock[]
): ExtractedPage {
  const blocks: Block[] = [...textBlocks, ...imageBlocks];
  
  // Sort blocks top to bottom (Y descending in PDF space)
  blocks.sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > 4) return dy;
    return a.x - b.x;
  });

  return {
    pageIndex,
    width,
    height,
    blocks
  };
}

export function assembleDocument(pages: ExtractedPage[], title?: string): ExtractedDocument {
  // Phase 8: Document Assembly
  // For v1, we just return the pages as-is (per-page grouping).
  // In the future, this is where we'd merge paragraphs across page breaks.
  return {
    title,
    pages
  };
}
