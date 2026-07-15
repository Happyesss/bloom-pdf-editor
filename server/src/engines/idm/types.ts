import type { BoundingBox } from '../common/geometry.js';

/**
 * Intermediate Document Model (IDM) — Phase 4
 *
 * Canonical, format-independent document representation.
 * Exporters consume ONLY this model — never PDF / Raw / Layout objects.
 *
 * Constraints: no heading classification, no table detection, no style inference,
 * no OCR, no export. Style candidates are placeholders for later phases.
 */

export const IDM_VERSION = '1.0.0' as const;

export type StyleCandidate =
  | 'Possible Heading'
  | 'Possible Caption'
  | 'Possible Quote'
  | 'Possible List'
  | 'Possible Table'
  | 'Possible Title'
  | 'Possible Code';

export type BlockType =
  | 'paragraph'
  | 'title'
  | 'heading'
  | 'caption'
  | 'image'
  | 'table_placeholder'
  | 'list_placeholder'
  | 'header'
  | 'footer'
  | 'sidebar'
  | 'footnote'
  | 'endnote'
  | 'code_block'
  | 'quote'
  | 'unknown';

export type WritingDirection = 'ltr' | 'rtl' | 'ttb';
export type TextAlignment = 'left' | 'center' | 'right' | 'justify' | 'mixed';
export type AnchorType = 'inline' | 'floating' | 'absolute';
export type WrappingType = 'inline' | 'square' | 'tight' | 'behind' | 'front' | 'none';

export interface IdmNodeBase {
  id: string;
  parentId: string | null;
  childIds: string[];
  previousId: string | null;
  nextId: string | null;
  pageIndex: number;
  sectionId: string | null;
  readingOrderIndex: number;
  logicalOrderIndex: number;
  bbox?: BoundingBox;
  styleCandidates: StyleCandidate[];
}

export interface DocumentMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
  creationDate?: string;
  modificationDate?: string;
  language?: string;
  pageCount: number;
}

export interface IntermediateDocument {
  id: string;
  version: typeof IDM_VERSION;
  /** Frozen after generation — treat as immutable. */
  immutable: true;
  metadata: DocumentMetadata;
  sections: Section[];
  bookmarks: Bookmark[];
  footnotes: Footnote[];
  endnotes: Footnote[];
  hyperlinks: Hyperlink[];
  /** Flat index for O(1) lookup. */
  nodeIndex: Record<string, IdmNodeRef>;
  sourceLayoutId?: string;
  sourceRawId?: string;
}

export type IdmNodeRef =
  | { kind: 'section'; id: string }
  | { kind: 'page'; id: string }
  | { kind: 'block'; id: string }
  | { kind: 'run'; id: string }
  | { kind: 'word'; id: string }
  | { kind: 'character'; id: string }
  | { kind: 'bookmark'; id: string }
  | { kind: 'footnote'; id: string }
  | { kind: 'hyperlink'; id: string };

export interface Section extends IdmNodeBase {
  title?: string;
  pages: Page[];
  breakBefore?: 'none' | 'section' | 'page';
}

export interface Page extends IdmNodeBase {
  index: number;
  width: number;
  height: number;
  blocks: Block[];
  headers: HeaderFooter[];
  footers: HeaderFooter[];
  pageBreakAfter?: boolean;
}

export type Block =
  | ParagraphBlock
  | TitleBlock
  | HeadingBlock
  | CaptionBlock
  | ImageBlock
  | TablePlaceholderBlock
  | ListPlaceholderBlock
  | SidebarBlock
  | FootnoteBlock
  | CodeBlock
  | QuoteBlock
  | UnknownBlock;

export interface BlockBase extends IdmNodeBase {
  type: BlockType;
  alignment?: TextAlignment;
  writingDirection?: WritingDirection;
  rotation?: number;
  /** Layout region id that produced this block. */
  sourceRegionId?: string;
}

export interface TextContainerBlock extends BlockBase {
  runs: Run[];
  words: Word[];
  characters: Character[];
}

export interface ParagraphBlock extends TextContainerBlock {
  type: 'paragraph';
}

export interface TitleBlock extends TextContainerBlock {
  type: 'title';
}

/** Provisional heading from layout geometry — level is candidate only, not classified. */
export interface HeadingBlock extends TextContainerBlock {
  type: 'heading';
  /** Unfinalized hint from layout font-size band; exporters must not treat as final. */
  provisionalLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}

export interface CaptionBlock extends TextContainerBlock {
  type: 'caption';
}

export interface SidebarBlock extends TextContainerBlock {
  type: 'sidebar';
}

export interface FootnoteBlock extends TextContainerBlock {
  type: 'footnote' | 'endnote';
  marker?: string;
}

export interface CodeBlock extends TextContainerBlock {
  type: 'code_block';
}

export interface QuoteBlock extends TextContainerBlock {
  type: 'quote';
}

export interface UnknownBlock extends TextContainerBlock {
  type: 'unknown';
}

export interface ImageBlock extends BlockBase {
  type: 'image';
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  anchorType: AnchorType;
  wrappingType: WrappingType;
  /** Reference to original raw image object id / resource. */
  originalResourceId?: string;
  resourceName?: string;
  resolutionDpi?: number;
  compression?: string | null;
  colorSpace?: string | null;
  mimeType?: string;
  /** Optional inline bytes (omitted in summaries). */
  data?: Uint8Array;
  alt?: string;
}

/** Placeholder only — Phase 4 does not detect table structure. */
export interface TablePlaceholderBlock extends BlockBase {
  type: 'table_placeholder';
  runs: Run[];
  words: Word[];
  characters: Character[];
}

/** Placeholder only — Phase 4 does not detect lists. */
export interface ListPlaceholderBlock extends BlockBase {
  type: 'list_placeholder';
  ordered: boolean;
  runs: Run[];
  words: Word[];
  characters: Character[];
}

export interface Run extends IdmNodeBase {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  fontName?: string;
  fontSize?: number;
  fontWeight?: number;
  color?: string;
  backgroundColor?: string;
  characterSpacing?: number;
  wordSpacing?: number;
  writingDirection?: WritingDirection;
  rotation?: number;
  link?: string;
  wordIds: string[];
  characterIds: string[];
}

export interface Word extends IdmNodeBase {
  text: string;
  characterIds: string[];
  runId: string | null;
}

export interface Character extends IdmNodeBase {
  unicode: string;
  glyphId?: number;
  fontName?: string;
  fontSize?: number;
  fontWeight?: number;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  characterSpacing?: number;
  wordSpacing?: number;
  writingDirection?: WritingDirection;
  rotation?: number;
  /** Raw character object id. */
  sourceObjectId?: string;
}

export interface HeaderFooter {
  id: string;
  blocks: Block[];
}

export interface Footnote {
  id: string;
  marker: string;
  blocks: Block[];
  pageIndex: number;
}

export interface Bookmark {
  id: string;
  title: string;
  pageIndex: number;
  targetBlockId?: string;
  children?: Bookmark[];
}

export interface Hyperlink {
  id: string;
  uri: string;
  text?: string;
  pageIndex: number;
  bbox?: BoundingBox;
  sourceObjectId?: string;
}

/** Empty IDM shell. */
export function createEmptyDocument(
  id: string,
  pageCount = 0,
  metadata: Partial<DocumentMetadata> = {},
): IntermediateDocument {
  return {
    id,
    version: IDM_VERSION,
    immutable: true,
    metadata: {
      pageCount,
      ...metadata,
    },
    sections: [],
    bookmarks: [],
    footnotes: [],
    endnotes: [],
    hyperlinks: [],
    nodeIndex: {},
  };
}
