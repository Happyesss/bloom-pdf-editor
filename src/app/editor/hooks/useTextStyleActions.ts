/**
 * Apply text style patches from the properties sidebar.
 */

import { useCallback } from 'react';
import type { PDFDocumentData, TextLine, TextStylePatch } from '@/engine';
import { hexToRGB } from '../utils';

export interface TextStyleUI {
  fontFamily: string;
  fontSize: number;
  color: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  align: 'left' | 'center' | 'right';
  opacity: number;
}

export function useTextStyleActions(
  engineRef: React.MutableRefObject<typeof import('@/engine') | null>,
  doc: PDFDocumentData | null,
  currentPage: number,
  selectedLine: TextLine | null,
  onApplied: () => void,
) {
  const applyStyle = useCallback(async (patch: Partial<TextStyleUI>) => {
    if (!doc || !engineRef.current || !selectedLine) return;
    // Don't mutate PDF while actively typing in a line — commit text first
    const engine = engineRef.current;

    const style: TextStylePatch = {};
    if (patch.fontSize != null) style.fontSize = patch.fontSize;
    if (patch.color != null) {
      style.color = hexToRGB(patch.color);
    }
    if (patch.bold != null) style.bold = patch.bold;
    if (patch.italic != null) style.italic = patch.italic;
    if (patch.underline != null) style.underline = patch.underline;
    if (patch.align != null) style.align = patch.align;

    // Only apply keys that were explicitly requested
    if (Object.keys(style).length === 0) return;

    await engine.applyStyleToSelectionOnPage(
      doc,
      currentPage,
      selectedLine,
      0,
      selectedLine.text.length,
      style,
    );
    onApplied();
  }, [doc, engineRef, currentPage, selectedLine, onApplied]);

  return { applyStyle };
}
