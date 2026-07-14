export interface PositionedGlyph {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
}

export interface TextRun {
  text: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
}

export interface ParagraphBlock {
  type: 'paragraph';
  x: number;
  y: number;
  width: number;
  height: number;
  runs: TextRun[];
  align?: 'left' | 'center' | 'right' | 'justify';
}

export interface HeadingBlock {
  type: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  x: number;
  y: number;
  width: number;
  height: number;
  runs: TextRun[];
  align?: 'left' | 'center' | 'right';
  accentBorder?: string; // e.g., if there's a horizontal rule under it
}

export interface ListBlock {
  type: 'list';
  marker: 'bullet' | 'number';
  x: number;
  y: number;
  width: number;
  height: number;
  runs: TextRun[];
}

export interface TableCellBlock {
  row: number;
  col: number;
  rowSpan?: number;
  colSpan?: number;
  runs: TextRun[]; // Simplification for v1, in the future this could be `blocks: Block[]`
  isHeader?: boolean;
}

export interface TableBlock {
  type: 'table';
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  cols: number;
  columnWidths: number[];
  cells: TableCellBlock[];
  headerFill?: string;
  headerColor?: string;
  borderColor?: string;
}

export interface ImageBlock {
  type: 'image';
  x: number;
  y: number;
  width: number;
  height: number;
  imageData: Uint8Array;
  mimeType: string;
}

export interface SplitBlock {
  type: 'split';
  x: number;
  y: number;
  width: number;
  height: number;
  leftRuns: TextRun[];
  rightRuns: TextRun[];
}

export interface HRuleBlock {
  type: 'hrule';
  x: number;
  y: number;
  width: number;
  height: number;
  accentBorder: string;
}

export type Block = ParagraphBlock | HeadingBlock | ListBlock | TableBlock | ImageBlock | SplitBlock | HRuleBlock;

export interface ExtractedPage {
  pageIndex: number;
  width: number;
  height: number;
  blocks: Block[];
}

export interface ExtractedDocument {
  title?: string;
  pages: ExtractedPage[];
}
