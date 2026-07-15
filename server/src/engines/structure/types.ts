import type { BoundingBox } from '../common/geometry.js';

/** Phase 9 — format-independent document structure model (no export). */

export type HeaderFooterVariant =
  | 'running'
  | 'odd'
  | 'even'
  | 'first'
  | 'chapter'
  | 'section'
  | 'copyright'
  | 'confidential'
  | 'company'
  | 'revision'
  | 'version'
  | 'unknown';

export type PageNumberStyle = 'arabic' | 'roman' | 'alphabetic' | 'mixed' | 'hidden';

export type StructureNodeKind =
  | 'document'
  | 'part'
  | 'chapter'
  | 'section'
  | 'subsection'
  | 'paragraph';

export interface RunningRegion {
  id: string;
  kind: 'header' | 'footer';
  variant: HeaderFooterVariant;
  text: string;
  pageIndices: number[];
  bboxSample?: BoundingBox;
  confidence: number;
}

export interface PageNumberEntry {
  id: string;
  pageIndex: number;
  value: string;
  style: PageNumberStyle;
  numericValue?: number;
  bbox?: BoundingBox;
  confidence: number;
}

export interface FootnoteEntry {
  id: string;
  kind: 'footnote' | 'endnote';
  marker: string;
  body: string;
  referencePageIndex: number;
  bodyPageIndex: number;
  referenceNodeId?: string;
  continuedFrom?: string;
  confidence: number;
}

export interface TocEntry {
  id: string;
  title: string;
  level: number;
  pageLabel?: string;
  pageIndex?: number;
  targetHeadingId?: string;
  hasLeaderDots: boolean;
  confidence: number;
}

export interface BookmarkNode {
  id: string;
  title: string;
  pageIndex: number;
  children: BookmarkNode[];
  sourceId?: string;
  confidence: number;
}

export interface HyperlinkEntry {
  id: string;
  kind: 'external' | 'internal' | 'email' | 'cross_reference' | 'named_destination';
  uri?: string;
  text?: string;
  pageIndex: number;
  dest?: unknown;
  targetId?: string;
  confidence: number;
}

export interface StructureNode {
  id: string;
  kind: StructureNodeKind;
  title?: string;
  pageIndex?: number;
  parentId: string | null;
  childIds: string[];
  semanticNodeIds: string[];
  previousId?: string;
  nextId?: string;
  confidence: number;
}

export interface DocumentMetadataView {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  language?: string;
  creationDate?: string;
  modificationDate?: string;
  producer?: string;
  creator?: string;
}

export interface StructureQualityScores {
  headers: number;
  footers: number;
  pageNumbers: number;
  footnotes: number;
  toc: number;
  bookmarks: number;
  crossReferences: number;
  overall: number;
}

export interface DocumentStructureModel {
  id: string;
  sourceDocumentId: string;
  metadata: DocumentMetadataView;
  headers: RunningRegion[];
  footers: RunningRegion[];
  pageNumbers: PageNumberEntry[];
  footnotes: FootnoteEntry[];
  endnotes: FootnoteEntry[];
  toc: TocEntry[];
  bookmarks: BookmarkNode[];
  hyperlinks: HyperlinkEntry[];
  root: StructureNode;
  nodes: Record<string, StructureNode>;
  quality: StructureQualityScores;
}

export interface DocumentStructureResult {
  id: string;
  structure: DocumentStructureModel;
}
