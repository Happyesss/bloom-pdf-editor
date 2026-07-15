import type { BoundingBox } from '../common/geometry.js';
import type { TextAlignment, WritingDirection } from '../idm/types.js';

export type SemanticType =
  | 'document'
  | 'section'
  | 'subsection'
  | 'title'
  | 'subtitle'
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'list_item'
  | 'caption'
  | 'quote'
  | 'code_block'
  | 'image'
  | 'table'
  | 'hyperlink'
  | 'unknown';

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

export type ListStyle =
  | 'bullet'
  | 'numbered'
  | 'alphabetic'
  | 'roman'
  | 'checkbox'
  | 'unknown';

export interface SemanticRun {
  id: string;
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fontName?: string;
  fontSize?: number;
  color?: string;
  link?: string;
  styleProfileId?: string;
}

export interface SemanticNodeBase {
  id: string;
  type: SemanticType;
  parentId: string | null;
  childIds: string[];
  readingOrderIndex: number;
  confidence: number;
  pageIndex: number;
  bbox?: BoundingBox;
  /** Source IDM block id(s). */
  sourceBlockIds: string[];
  styleProfileId?: string;
}

export interface SemanticParagraph extends SemanticNodeBase {
  type: 'paragraph';
  runs: SemanticRun[];
  text: string;
  alignment?: TextAlignment;
  writingDirection?: WritingDirection;
}

export interface SemanticHeading extends SemanticNodeBase {
  type: 'heading' | 'title' | 'subtitle';
  level: HeadingLevel;
  runs: SemanticRun[];
  text: string;
}

export interface SemanticListItem extends SemanticNodeBase {
  type: 'list_item';
  runs: SemanticRun[];
  text: string;
  level: number;
  marker: string;
}

export interface SemanticList extends SemanticNodeBase {
  type: 'list';
  listStyle: ListStyle;
  ordered: boolean;
  items: SemanticListItem[];
}

export interface SemanticCaption extends SemanticNodeBase {
  type: 'caption';
  runs: SemanticRun[];
  text: string;
  /** Linked image/figure node id when known. */
  targetId?: string;
}

export interface SemanticQuote extends SemanticNodeBase {
  type: 'quote';
  runs: SemanticRun[];
  text: string;
}

export interface SemanticCodeBlock extends SemanticNodeBase {
  type: 'code_block';
  runs: SemanticRun[];
  text: string;
  languageHint?: string;
}

export interface SemanticImage extends SemanticNodeBase {
  type: 'image';
  width: number;
  height: number;
  alt?: string;
  resourceId?: string;
}

/** Phase 7 — logical table summary; full grid lives in TableDetectionResult. */
export interface SemanticTable extends SemanticNodeBase {
  type: 'table';
  logicalTableId: string;
  rowCount: number;
  columnCount: number;
  kind: 'bordered' | 'borderless' | 'mixed';
  /** Absorbed semantic node ids that became cells. */
  absorbedNodeIds: string[];
}

export interface SemanticSection extends SemanticNodeBase {
  type: 'section' | 'subsection';
  title?: string;
  headingId?: string;
  children: SemanticNode[];
}

export interface SemanticHyperlink extends SemanticNodeBase {
  type: 'hyperlink';
  uri: string;
  text?: string;
}

export type SemanticNode =
  | SemanticParagraph
  | SemanticHeading
  | SemanticList
  | SemanticListItem
  | SemanticCaption
  | SemanticQuote
  | SemanticCodeBlock
  | SemanticImage
  | SemanticTable
  | SemanticSection
  | SemanticHyperlink
  | (SemanticNodeBase & { type: 'unknown' | 'document'; text?: string });

export interface SemanticDocument {
  id: string;
  sourceDocumentId: string;
  sourceLayoutId?: string;
  typographyAnalysisId?: string;
  title?: string;
  sections: SemanticSection[];
  /** Flat reading-order list of content nodes (excludes section wrappers). */
  readingOrder: string[];
  /** All nodes by id. */
  nodes: Record<string, SemanticNode>;
  quality: SemanticQualityScores;
}

export interface SemanticQualityScores {
  heading: number;
  paragraph: number;
  list: number;
  caption: number;
  quote: number;
  codeBlock: number;
  section: number;
  table?: number;
  overall: number;
}
