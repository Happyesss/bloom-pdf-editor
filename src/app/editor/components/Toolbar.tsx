import React from 'react';
import { ChevronLeft, ChevronRight, ZoomOut, ZoomIn, Download, X, Loader2, Undo2, Redo2 } from 'lucide-react';
import type { DrawnPath } from '../types';

interface ToolbarProps {
  fileName: string;
  currentPage: number;
  totalPages: number;
  scale: number;
  drawnPaths: DrawnPath[];
  isSaving: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onClose: () => void;
  onPrevPage: () => void;
  onNextPage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClearPaths: () => void;
  onDownload: () => void;
}

export function Toolbar({
  fileName,
  currentPage,
  totalPages,
  scale,
  drawnPaths,
  isSaving,
  canUndo,
  canRedo,
  onClose,
  onPrevPage,
  onNextPage,
  onZoomIn,
  onZoomOut,
  onUndo,
  onRedo,
  onClearPaths,
  onDownload
}: ToolbarProps) {
  return (
    <header className="flex items-center justify-between px-4 h-14 bg-zinc-900/80 backdrop-blur-lg border-b border-zinc-800/80 shrink-0 z-20">
      <div className="flex items-center gap-3">
        <button 
          onClick={onClose} 
          className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all duration-200" 
          title="Close file"
        >
          <X size={18} />
        </button>
        <span className="text-zinc-300 font-medium text-sm truncate max-w-[250px]">{fileName}</span>
      </div>

      <div className="flex items-center gap-2 bg-zinc-900 px-2 py-1.5 rounded-lg border border-zinc-800 shadow-sm">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 size={16} />
        </button>

        <div className="w-[1px] h-4 bg-zinc-800 mx-1" />

        <button onClick={onPrevPage} disabled={currentPage === 0} className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors">
          <ChevronLeft size={18} />
        </button>
        <span className="text-zinc-400 text-xs font-medium w-16 text-center tracking-wider">
          {currentPage + 1} / {totalPages}
        </span>
        <button onClick={onNextPage} disabled={currentPage >= totalPages - 1} className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors">
          <ChevronRight size={18} />
        </button>

        <div className="w-[1px] h-4 bg-zinc-800 mx-2" />

        <button onClick={onZoomOut} disabled={scale <= 0.5} className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors">
          <ZoomOut size={16} />
        </button>
        <span className="text-zinc-400 text-xs font-medium w-12 text-center">
          {Math.round(scale * 100)}%
        </span>
        <button onClick={onZoomIn} disabled={scale >= 4} className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors">
          <ZoomIn size={16} />
        </button>
      </div>

      <div className="flex items-center gap-3">
        {drawnPaths.length > 0 && (
          <button
            onClick={onClearPaths}
            className="text-xs font-medium px-3 py-1.5 text-red-400 bg-red-400/10 hover:bg-red-400/20 rounded-md transition-colors"
          >
            Clear
          </button>
        )}
        <button
          onClick={onDownload}
          disabled={isSaving}
          className="flex items-center gap-2 text-xs font-medium px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg transition-colors shadow-lg shadow-blue-900/20"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Download
        </button>
      </div>
    </header>
  );
}
