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
  /** Nested blocks (e.g. table cells — future). */
  children?: SemanticBlock[];
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

export interface ExportPageInput {
  pageIndex: number;
  width: number;
  height: number;
  lines: ExportLineInput[];
  title?: string;
}
