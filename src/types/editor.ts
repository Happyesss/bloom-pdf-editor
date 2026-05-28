export type ToolType =
  | 'select'
  | 'editText'   // ← Adobe "Edit PDF" inline text mode
  | 'text'
  | 'draw'
  | 'highlight'
  | 'underline'
  | 'strikethrough'
  | 'rectangle'
  | 'ellipse'
  | 'arrow'
  | 'line'
  | 'image'
  | 'signature'
  | 'redact'
  | 'stamp'
  | 'eraser'
  | 'comment';

export interface ToolOptions {
  color: string;
  fillColor: string;
  strokeWidth: number;
  fontSize: number;
  fontFamily: string;
  fontBold: boolean;
  fontItalic: boolean;
  opacity: number;
  stampType: string; // active stamp for the stamp tool
}

export interface PageOverlay {
  json: string; // serialized Fabric canvas JSON
}

export interface HistoryEntry {
  pageIndex: number;
  json: string;
}

export interface TextSearchMatch {
  pageIndex: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface WatermarkOptions {
  text: string;
  fontSize: number;
  color: string;
  opacity: number;
  angle: number;
  repeat: boolean;
}
