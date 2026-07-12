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
  /** Optional [start,end) — when omitted, styles the whole line. */
  getSelectionRange?: () => { start: number; end: number } | null,
) {
  const applyStyle = useCallback(async (
    patch: Partial<TextStyleUI>,
    rangeOverride?: { start: number; end: number },
  ) => {
    if (!doc || !engineRef.current || !selectedLine) return;
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

    if (Object.keys(style).length === 0) return;

    const sel = rangeOverride ?? getSelectionRange?.() ?? null;
    let start = 0;
    let end = selectedLine.text.length;
    if (sel) {
      start = Math.max(0, Math.min(sel.start, selectedLine.text.length));
      end = Math.max(start, Math.min(sel.end, selectedLine.text.length));
      // Collapsed caret → style only the run under the caret (Word-like)
      if (end <= start) {
        const seg = engine.segmentAtIndex(selectedLine, start);
        if (seg) {
          start = seg.startIndex;
          end = seg.endIndex;
        }
      }
    }

    await engine.applyStyleToSelectionOnPage(
      doc,
      currentPage,
      selectedLine,
      start,
      end,
      style,
    );
    onApplied();
  }, [doc, engineRef, currentPage, selectedLine, onApplied, getSelectionRange]);

  return { applyStyle };
}
