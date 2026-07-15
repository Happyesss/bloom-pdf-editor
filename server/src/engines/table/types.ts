import type { BoundingBox } from '../common/geometry.js';
import type { SemanticDocument, SemanticRun } from '../semantic/types.js';

/** Phase 7 — format-independent logical table model (not DOCX/XLSX). */

export type TableKind = 'bordered' | 'borderless' | 'mixed';
export type RowRole = 'header' | 'body' | 'summary' | 'footer';
export type ColumnDataType = 'text' | 'numeric' | 'currency' | 'date' | 'percentage';
export type CellAlignment = 'left' | 'center' | 'right' | 'mixed';

export interface LogicalTableRelationships {
  continuedFrom?: string;
  nestedParent?: string;
  adjacentTo?: string[];
}

export interface LogicalCell {
  id: string;
  parentId: string;
  childIds: string[];
  rowIndex: number;
  colIndex: number;
  rowSpan: number;
  colSpan: number;
  bbox: BoundingBox;
  /** Union of source content bboxes (for merge/span heuristics). */
  contentBBox?: BoundingBox;
  text: string;
  runs: SemanticRun[];
  alignment: CellAlignment;
  padding: { top: number; right: number; bottom: number; left: number };
  borderStyle?: string;
  backgroundColor?: string;
  contentNodeIds: string[];
  confidence: number;
}

export interface LogicalRow {
  id: string;
  parentId: string;
  childIds: string[];
  rowIndex: number;
  height: number;
  role: RowRole;
  confidence: number;
}

export interface LogicalColumn {
  id: string;
  parentId: string;
  colIndex: number;
  width: number;
  minWidth: number;
  maxWidth: number;
  alignment: CellAlignment;
  dataType: ColumnDataType;
  confidence: number;
}

export interface LogicalTable {
  id: string;
  pageIndex: number;
  bbox: BoundingBox;
  kind: TableKind;
  confidence: number;
  rows: LogicalRow[];
  columns: LogicalColumn[];
  cells: LogicalCell[];
  relationships: LogicalTableRelationships;
  quality: TableQualityScores;
}

export interface TableQualityScores {
  table: number;
  row: number;
  column: number;
  cell: number;
  mergedCell: number;
  header: number;
}

export interface TableDetectionResult {
  id: string;
  tables: LogicalTable[];
  /** Semantic document with table nodes attached and absorbed paragraphs removed. */
  semantic: SemanticDocument;
}

export interface TableCandidate {
  pageIndex: number;
  bbox: BoundingBox;
  nodeIds: string[];
  score: number;
  hasVectorBorders: boolean;
}

export interface GridLine {
  orientation: 'h' | 'v';
  position: number;
  start: number;
  end: number;
  strokeWidth: number;
}

export interface TableGrid {
  xs: number[];
  ys: number[];
  kind: TableKind;
  lines: GridLine[];
  confidence: number;
}
