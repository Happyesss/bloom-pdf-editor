/**
 * Semantic export model — structured page content for HTML/Markdown conversion.
 */

/** Inline text styling preserved from PDF runs. */
export interface SemanticSpan {
  text: string;
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  link?: string;
}

/** Block-level semantic element on a page. */
export type SemanticBlockKind =
  | 'heading'
  | 'paragraph'
  | 'list-item'
  | 'table'
  | 'figure'
  | 'code'
  | 'blockquote';

export interface SemanticBlock {
  id: string;
  kind: SemanticBlockKind;
  /** Heading level 1–6 when kind === 'heading'. */
  level?: number;
  spans: SemanticSpan[];
  /** Plain text concatenation of spans. */
  text: string;
  /** PDF user-space bounding box (y-up). */
  x: number;
  y: number;
  width: number;
  height: number;
  /** List marker when kind === 'list-item'. */
  listMarker?: string;
  /** Nested blocks (e.g. row/cell hierarchy — optional). */
  children?: SemanticBlock[];
  /** Native table grid when kind === 'table' (Acrobat/iLovePDF-style). */
  table?: SemanticTableData;
}

/** One cell in a reconstructed table. */
export interface SemanticTableCell {
  row: number;
  col: number;
  spans: SemanticSpan[];
  text: string;
}

export interface SemanticTableData {
  rows: number;
  cols: number;
  cells: SemanticTableCell[];
  /** Column widths in PDF points (optional). */
  columnWidths?: number[];
}

/** Full semantic representation of one page. */
export interface SemanticPage {
  pageIndex: number;
  width: number;
  height: number;
  title?: string;
  blocks: SemanticBlock[];
  /** Reading order block IDs (may differ from array order for multi-column). */
  readingOrder: string[];
}

export interface ExportOptions {
  /** Include inline style attributes in HTML. */
  inlineStyles: boolean;
  /** Wrap output in full HTML document shell. */
  documentWrapper: boolean;
  /** Page title for HTML <title>. */
  title: string;
  /** Escape HTML entities (always true for safe output). */
  escapeHtml: boolean;
  /** Markdown heading style: 'atx' (#) or 'setext' (underline). */
  markdownHeadingStyle: 'atx' | 'setext';
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  inlineStyles: true,
  documentWrapper: true,
  title: 'Exported Page',
  escapeHtml: true,
  markdownHeadingStyle: 'atx',
};

/** Minimal input line for building semantic pages without full PDF parse. */
export interface ExportLineInput {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  bold?: boolean;
  italic?: boolean;
}

/** Table cell for export (from detectTablesOnPage). */
export interface ExportTableCellInput {
  row: number;
  col: number;
  text: string;
  fontSize: number;
  bold?: boolean;
  italic?: boolean;
}

export interface ExportTableInput {
  rows: number;
  cols: number;
  /** Top-left of table in PDF coords (y-up). */
  x: number;
  y: number;
  width: number;
  height: number;
  cells: ExportTableCellInput[];
  /** Column widths in PDF points. */
  columnWidths?: number[];
}

export interface ExportPageInput {
  pageIndex: number;
  width: number;
  height: number;
  lines: ExportLineInput[];
  /** Detected tables — those cell lines should be omitted from `lines`. */
  tables?: ExportTableInput[];
  title?: string;
}
