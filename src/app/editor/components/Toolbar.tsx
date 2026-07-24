import React from 'react';
import { ChevronLeft, ChevronRight, ZoomOut, ZoomIn, X, Undo2, Redo2, Search, FileOutput, Sun, Moon } from 'lucide-react';
import type { DrawnPath } from '../types';
import type { PDFDocumentData } from '@/engine';
import { DownloadDropdown } from './DownloadDropdown';
import { useTheme } from '@/app/theme/ThemeProvider';

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
  saveMode?: 'quick' | 'optimized';
  onSaveModeChange?: (mode: 'quick' | 'optimized') => void;
  onToggleSearch?: () => void;
  isSearchOpen?: boolean;
  /** Open the export panel */
  onExport?: () => void;
  /** PDF document for size estimation */
  doc?: PDFDocumentData | null;
  /** Compressed download handler */
  onCompressedDownload?: (opts: import('./DownloadDropdown').CompressedDownloadOptions) => void;
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
  onDownload,
  saveMode,
  onSaveModeChange,
  onToggleSearch,
  isSearchOpen,
  onExport,
  doc,
  onCompressedDownload,
}: ToolbarProps) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="flex items-center justify-between px-4 h-14 bg-panel/90 backdrop-blur-lg border-b border-app shrink-0 z-40">
      <div className="flex items-center gap-3">
        <button 
          onClick={onClose} 
          className="p-1.5 text-app-muted hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all duration-200" 
          title="Close file"
        >
          <X size={18} />
        </button>
        <span className="text-app font-medium text-sm truncate max-w-[250px] opacity-90">{fileName}</span>
      </div>

      <div className="flex items-center gap-2 bg-panel-elevated px-2 py-1.5 rounded-lg border border-app shadow-sm">
        <button
          onClick={onUndo}
          disabled={!canUndo}
          className="p-1 text-app-muted hover:text-app disabled:opacity-30 disabled:hover:text-app-muted transition-colors"
          title="Undo (Ctrl+Z)"
        >
          <Undo2 size={16} />
        </button>
        <button
          onClick={onRedo}
          disabled={!canRedo}
          className="p-1 text-app-muted hover:text-app disabled:opacity-30 disabled:hover:text-app-muted transition-colors"
          title="Redo (Ctrl+Shift+Z)"
        >
          <Redo2 size={16} />
        </button>

        <div className="w-[1px] h-4 bg-[var(--border)] mx-1" />

        <button onClick={onPrevPage} disabled={currentPage === 0} className="p-1 text-app-muted hover:text-app disabled:opacity-30 disabled:hover:text-app-muted transition-colors">
          <ChevronLeft size={18} />
        </button>
        <span className="text-app-muted text-xs font-medium w-16 text-center tracking-wider">
          {currentPage + 1} / {totalPages}
        </span>
        <button onClick={onNextPage} disabled={currentPage >= totalPages - 1} className="p-1 text-app-muted hover:text-app disabled:opacity-30 disabled:hover:text-app-muted transition-colors">
          <ChevronRight size={18} />
        </button>

        <div className="w-[1px] h-4 bg-[var(--border)] mx-2" />

        <button onClick={onZoomOut} disabled={scale <= 0.5} className="p-1 text-app-muted hover:text-app disabled:opacity-30 disabled:hover:text-app-muted transition-colors">
          <ZoomOut size={16} />
        </button>
        <span className="text-app-muted text-xs font-medium w-12 text-center">
          {Math.round(scale * 100)}%
        </span>
        <button onClick={onZoomIn} disabled={scale >= 4} className="p-1 text-app-muted hover:text-app disabled:opacity-30 disabled:hover:text-app-muted transition-colors">
          <ZoomIn size={16} />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={toggleTheme}
          className="p-2 rounded-lg transition-colors border bg-panel-elevated text-app-muted hover:text-app border-app"
          title={theme === 'dark' ? 'Switch to white mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {onToggleSearch && (
          <button
            onClick={onToggleSearch}
            className={`p-2 rounded-lg transition-colors border ${isSearchOpen ? 'bg-blue-600/20 text-blue-500 border-blue-500/50' : 'bg-panel-elevated text-app-muted hover:text-app border-app'}`}
            title="Toggle Find & Replace"
          >
            <Search size={16} />
          </button>
        )}

        {drawnPaths.length > 0 && (
          <button
            onClick={onClearPaths}
            className="text-xs font-medium px-3 py-1.5 text-red-400 bg-red-400/10 hover:bg-red-400/20 rounded-md transition-colors"
          >
            Clear
          </button>
        )}

        {onExport && (
          <>
            <div className="w-[1px] h-6 bg-[var(--border)]" />
            <button
              onClick={onExport}
              className="
                flex items-center gap-1.5 text-xs font-medium px-3 py-2
                bg-panel-elevated hover:opacity-90
                text-app-muted hover:text-app
                border border-app
                rounded-xl transition-all duration-200
              "
              title="Export to Word, PNG, Markdown, etc."
            >
              <FileOutput size={14} />
              Export
            </button>
          </>
        )}

        <div className="w-[1px] h-6 bg-[var(--border)]" />

        <DownloadDropdown
          isSaving={isSaving}
          onDownload={onDownload}
          saveMode={saveMode ?? 'optimized'}
          onSaveModeChange={onSaveModeChange ?? (() => {})}
          doc={doc ?? null}
          onCompressedDownload={onCompressedDownload}
        />
      </div>
    </header>
  );
}
