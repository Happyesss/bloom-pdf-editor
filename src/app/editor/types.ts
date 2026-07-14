import React from 'react';
import { 
  MousePointer2, 
  Type, 
  Highlighter, 
  PenTool, 
  Eraser,
  Stamp,
  PenLine,
  LucideIcon
} from 'lucide-react';

export type EditorTool = 'select' | 'text' | 'addtext' | 'highlight' | 'draw' | 'erase' | 'watermark' | 'redact' | 'sign' | 'link';

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
];

export type PathType = 'draw' | 'highlight';

export interface DrawnPath {
  id: string;
  type: PathType;
  color: string;
  size: number;
  points: { x: number; y: number }[];
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
