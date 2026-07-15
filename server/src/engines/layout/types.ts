import type { BoundingBox, Matrix2D } from '../common/geometry.js';

/**
 * Layout Analysis model (Phase 3).
 *
 * Geometric / structural only — no IDM paragraphs, no table grids, no export.
 * Region kind `text_block` is used instead of `paragraph` (constraint).
 * `table` is intentionally omitted until a later phase.
 */

export type LayoutRegionKind =
  | 'header'
  | 'footer'
  | 'title'
  | 'heading'
  | 'text_block'
  | 'caption'
  | 'image'
  | 'sidebar'
  | 'footnote'
  | 'endnote'
  | 'watermark'
  | 'background'
  | 'margin_note'
  | 'form_area'
  | 'unknown';

export type LayoutBlockKind =
  | 'word'
  | 'line'
  | 'text_cluster'
  | 'image'
  | 'vector'
  | 'annotation'
  | 'form'
  | 'unknown';

export type WritingDirection = 'ltr' | 'rtl' | 'ttb';
export type DominantAlignment = 'left' | 'center' | 'right' | 'mixed';

export interface LayoutNodeBase {
  id: string;
  bbox: BoundingBox;
  parentId: string | null;
  childIds: string[];
  readingOrderIndex: number;
  confidence: number;
}

export interface NormalizedPage {
  pageIndex: number;
  width: number;
  height: number;
  rotation: number;
  writingDirection: WritingDirection;
  /** Maps raw PDF user space → normalized layout space. */
  rawToNormalized: Matrix2D;
  mediaBox: BoundingBox;
  cropBox: BoundingBox;
}

export interface LayoutStyleKey {
  fontName: string;
  fontSize: number;
  fontWeight: number;
}

export interface LayoutBlock extends LayoutNodeBase {
  kind: LayoutBlockKind;
  /** Raw parser object ids that contributed to this block. */
  sourceObjectIds: string[];
  text?: string;
  style?: LayoutStyleKey;
  objectDensity: number;
  textDensity: number;
}

export interface LayoutRegion extends LayoutNodeBase {
  kind: LayoutRegionKind;
  readingPriority: number;
  objectDensity: number;
  textDensity: number;
  whitespaceDensity: number;
  averageFont?: string;
  averageFontSize?: number;
  dominantAlignment: DominantAlignment;
  rotation: number;
  writingDirection: WritingDirection;
  blocks: LayoutBlock[];
  /** Optional column index assigned during reading-order (0-based). */
  columnIndex?: number;
}

export interface ReadingOrderEdge {
  from: string;
  to: string;
  weight: number;
}

export interface ReadingOrderGraph {
  regionIds: string[];
  edges: ReadingOrderEdge[];
  /** Topological / column-aware linear order of region ids. */
  order: string[];
}

export interface LayoutPage extends LayoutNodeBase {
  pageIndex: number;
  width: number;
  height: number;
  normalized: NormalizedPage;
  regions: LayoutRegion[];
  readingOrder: ReadingOrderGraph;
}

export interface LayoutDocument {
  id: string;
  sourceDocumentId: string;
  pages: LayoutPage[];
}

/** Intermediate cluster used inside the pipeline (not part of public graph). */
export interface ClusteredObject {
  id: string;
  kind: LayoutBlockKind;
  bbox: BoundingBox;
  sourceObjectIds: string[];
  text?: string;
  style?: LayoutStyleKey;
  baseline?: number;
  pageIndex: number;
}

export interface WhitespaceSignals {
  pageIndex: number;
  margins: { left: number; right: number; top: number; bottom: number };
  /** Vertical gutters that may indicate columns (x centers in normalized space). */
  columnGutters: number[];
  /** Large horizontal gaps (y positions) — paragraph/region separators. */
  horizontalGaps: number[];
  /** Large vertical gaps (x positions). */
  verticalGaps: number[];
  hProjection: number[];
  vProjection: number[];
}

export interface SegmentCandidate {
  bbox: BoundingBox;
  blockIds: string[];
  columnHint?: number;
}
