import React from 'react';
import type { EditorTool } from '../types';
import { TOOLS } from '../types';
import type { TextRun, RenderResult, PDFDocumentData } from '@/engine';

interface StatusBarProps {
  renderResult: RenderResult | null;
  activeTool: EditorTool;
  selectedRun: TextRun | null;
  doc: PDFDocumentData | null;
  totalPages: number;
}

export function StatusBar({
  renderResult,
  activeTool,
  selectedRun,
  doc,
  totalPages
}: StatusBarProps) {
  return (
    <footer className="flex items-center justify-between px-4 h-7 bg-zinc-900 border-t border-zinc-800 shrink-0 select-none">
      <span className="text-[10px] font-medium tracking-wider text-zinc-500">
        {renderResult
          ? `${renderResult.pageWidth.toFixed(0)} × ${renderResult.pageHeight.toFixed(0)} PT`
          : ''}
      </span>
      <span className="text-[10px] font-medium tracking-wider text-zinc-500 flex items-center gap-2">
        <span>TOOL: <span className="text-zinc-300">{TOOLS.find(t => t.id === activeTool)?.label.toUpperCase()}</span></span>
        {selectedRun && (
          <>
            <span className="w-1 h-1 rounded-full bg-zinc-700" />
            <span>SELECTED: <span className="text-zinc-300">&quot;{selectedRun.text.substring(0, 30)}{selectedRun.text.length > 30 ? '…' : ''}&quot;</span></span>
          </>
        )}
      </span>
      <span className="text-[10px] font-medium tracking-wider text-zinc-500">
        {renderResult ? `${renderResult.textRuns.length} RUNS` : ''}
        {doc ? ` • ${totalPages} PAGES • v${doc.version}` : ''}
      </span>
    </footer>
  );
}
