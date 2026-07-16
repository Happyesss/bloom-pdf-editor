import React from 'react';
import { 
  MousePointer2, 
  Type, 
  Highlighter, 
  PenTool, 
  Eraser,
  Stamp,
  PenLine,
  Shield,
  LucideIcon
} from 'lucide-react';

export type EditorTool = 'select' | 'text' | 'addtext' | 'highlight' | 'draw' | 'erase' | 'watermark' | 'redact' | 'sign' | 'link' | 'security';

export interface ToolDef {
  id: EditorTool;
  label: string;
  icon: LucideIcon;
  shortcut: string;
}

export const TOOLS: ToolDef[] = [
  { id: 'select',    label: 'Select',    icon: MousePointer2,  shortcut: 'V' },
  { id: 'text',      label: 'Edit Text', icon: Type,  shortcut: 'T' },
  { id: 'highlight', label: 'Highlight', icon: Highlighter, shortcut: 'H' },
  { id: 'draw',      label: 'Draw',      icon: PenTool,  shortcut: 'D' },
  { id: 'erase',     label: 'Erase',     icon: Eraser,  shortcut: 'E' },
  { id: 'watermark', label: 'Watermark', icon: Stamp,   shortcut: 'W' },
  { id: 'sign',      label: 'Sign',      icon: PenLine, shortcut: 'S' },
  { id: 'security',  label: 'Security',  icon: Shield,  shortcut: 'X' },
];

export type PathType = 'draw' | 'highlight';

/** Sub-modes for the Draw tool */
export type DrawMode = 'freehand' | 'line' | 'arrow' | 'rectangle' | 'ellipse';

export interface DrawnPath {
  id: string;
  type: PathType;
  /** Geometry kind; defaults to freehand when omitted */
  kind?: DrawMode;
  color: string;
  size: number;
  /** Freehand stroke points (canvas CSS px) */
  points: { x: number; y: number }[];
  /** Shape endpoints (canvas CSS px) — used when kind !== freehand */
  start?: { x: number; y: number };
  end?: { x: number; y: number };
}

export interface FloatingText {
  id: string;
  pdfX: number;
  pdfY: number;
  pdfWidth?: number;
  pdfHeight?: number;
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
}

export interface FloatingImage {
  id: string;
  pdfX: number;
  pdfY: number;
  pdfWidth: number;
  pdfHeight: number;
  dataUrl: string;
}
