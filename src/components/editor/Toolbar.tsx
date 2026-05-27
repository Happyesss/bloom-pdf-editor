'use client';

import { cn } from '@/lib/utils';
import type { ToolType, ToolOptions } from '@/types/editor';
import {
  MousePointer2, Type, Pen, Highlighter, Minus, Square, Circle,
  Image, PenLine, Trash2, ZoomIn, ZoomOut, RotateCcw, Download,
  Search, Stamp, Droplets, FileStack, Undo2, Redo2,
  Underline, Strikethrough, ArrowRight, MessageSquare, FileEdit,
} from 'lucide-react';

interface ToolbarProps {
  activeTool: ToolType;
  toolOptions: ToolOptions;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  fileName: string;
  onToolChange: (tool: ToolType) => void;
  onToolOptionChange: <K extends keyof ToolOptions>(key: K, value: ToolOptions[K]) => void;
  onZoomChange: (zoom: number) => void;
  onUndo: () => void;
  onRedo: () => void;
  onSearch: () => void;
  onWatermark: () => void;
  onExport: () => void;
  onPageManager: () => void;
  onImageInsert: () => void;
  onSignature: () => void;
}

interface ToolButtonProps {
  icon: React.ReactNode;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function ToolBtn({ icon, label, active, disabled, onClick }: ToolButtonProps) {
  return (
    <button
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center w-10 h-10 rounded-lg transition-all text-xs gap-0.5',
        active ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/30' : 'text-zinc-300 hover:bg-zinc-700 hover:text-white',
        disabled ? 'opacity-30 cursor-not-allowed pointer-events-none' : 'cursor-pointer'
      )}
    >
      {icon}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-8 bg-zinc-700 mx-1" />;
}

export default function Toolbar({
  activeTool,
  toolOptions,
  zoom,
  canUndo,
  canRedo,
  fileName,
  onToolChange,
  onToolOptionChange,
  onZoomChange,
  onUndo,
  onRedo,
  onSearch,
  onWatermark,
  onExport,
  onPageManager,
  onImageInsert,
  onSignature,
}: ToolbarProps) {
  return (
    <div className="flex items-center gap-1 px-3 py-2 bg-zinc-900 border-b border-zinc-700 flex-wrap">
      {/* File name */}
      <span className="text-sm font-medium text-zinc-300 mr-2 max-w-[140px] truncate" title={fileName}>
        {fileName}
      </span>

      <Divider />

      {/* History */}
      <ToolBtn icon={<Undo2 size={16} />} label="Undo (Ctrl+Z)" disabled={!canUndo} onClick={onUndo} />
      <ToolBtn icon={<Redo2 size={16} />} label="Redo (Ctrl+Y)" disabled={!canRedo} onClick={onRedo} />

      <Divider />

      {/* ── Edit PDF mode (Adobe-style inline text editing) ── */}
      <button
        title="Edit PDF Text — click any text to edit it in-place"
        onClick={() => onToolChange(activeTool === 'editText' ? 'select' : 'editText')}
        className={cn(
          'flex items-center gap-1.5 px-2.5 h-9 rounded-lg text-xs font-semibold transition-all',
          activeTool === 'editText'
            ? 'bg-amber-500 text-white shadow-lg shadow-amber-500/40 ring-2 ring-amber-400'
            : 'text-amber-400 border border-amber-500/40 hover:bg-amber-500/10'
        )}
      >
        <FileEdit size={15} />
        <span className="hidden sm:inline">Edit PDF</span>
      </button>

      <Divider />

      {/* Selection & Drawing */}
      <ToolBtn icon={<MousePointer2 size={16} />} label="Select (V)" active={activeTool === 'select'} onClick={() => onToolChange('select')} />
      <ToolBtn icon={<Type size={16} />} label="Add Text (T)" active={activeTool === 'text'} onClick={() => onToolChange('text')} />
      <ToolBtn icon={<Pen size={16} />} label="Draw (D)" active={activeTool === 'draw'} onClick={() => onToolChange('draw')} />
      <ToolBtn icon={<Trash2 size={14} />} label="Eraser (E)" active={activeTool === 'eraser'} onClick={() => onToolChange('eraser')} />

      <Divider />

      {/* Shapes */}
      <ToolBtn icon={<Square size={16} />} label="Rectangle" active={activeTool === 'rectangle'} onClick={() => onToolChange('rectangle')} />
      <ToolBtn icon={<Circle size={16} />} label="Ellipse" active={activeTool === 'ellipse'} onClick={() => onToolChange('ellipse')} />
      <ToolBtn icon={<Minus size={16} />} label="Line" active={activeTool === 'line'} onClick={() => onToolChange('line')} />
      <ToolBtn icon={<ArrowRight size={16} />} label="Arrow" active={activeTool === 'arrow'} onClick={() => onToolChange('arrow')} />

      <Divider />

      {/* Annotations */}
      <ToolBtn icon={<Highlighter size={16} />} label="Highlight (H)" active={activeTool === 'highlight'} onClick={() => onToolChange('highlight')} />
      <ToolBtn icon={<Underline size={16} />} label="Underline" active={activeTool === 'underline'} onClick={() => onToolChange('underline')} />
      <ToolBtn icon={<Strikethrough size={16} />} label="Strikethrough" active={activeTool === 'strikethrough'} onClick={() => onToolChange('strikethrough')} />
      <ToolBtn icon={<MessageSquare size={14} />} label="Comment" active={activeTool === 'comment'} onClick={() => onToolChange('comment')} />

      <Divider />

      {/* Advanced */}
      <ToolBtn icon={<PenLine size={16} />} label="Signature (S)" active={activeTool === 'signature'} onClick={onSignature} />
      <ToolBtn icon={<Image size={16} />} label="Insert Image" onClick={onImageInsert} />
      <ToolBtn icon={<Stamp size={16} />} label="Redact" active={activeTool === 'redact'} onClick={() => onToolChange('redact')} />

      <Divider />

      {/* Tool options */}
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5" title="Color">
          <input
            type="color"
            value={toolOptions.color}
            onChange={(e) => onToolOptionChange('color', e.target.value)}
            className="w-7 h-7 rounded cursor-pointer border border-zinc-600 bg-transparent p-0"
          />
        </label>
        <select
          value={toolOptions.strokeWidth}
          onChange={(e) => onToolOptionChange('strokeWidth', Number(e.target.value))}
          className="bg-zinc-800 text-zinc-300 text-xs rounded px-1.5 py-1 border border-zinc-700 h-7"
          title="Stroke width"
        >
          {[1, 2, 3, 4, 6, 8, 12].map((w) => (
            <option key={w} value={w}>{w}px</option>
          ))}
        </select>
        <select
          value={toolOptions.fontSize}
          onChange={(e) => onToolOptionChange('fontSize', Number(e.target.value))}
          className="bg-zinc-800 text-zinc-300 text-xs rounded px-1.5 py-1 border border-zinc-700 h-7"
          title="Font size"
        >
          {[10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64].map((s) => (
            <option key={s} value={s}>{s}pt</option>
          ))}
        </select>
        <select
          value={toolOptions.fontFamily}
          onChange={(e) => onToolOptionChange('fontFamily', e.target.value)}
          className="bg-zinc-800 text-zinc-300 text-xs rounded px-1.5 py-1 border border-zinc-700 h-7"
          title="Font family"
        >
          {['Arial', 'Times New Roman', 'Courier New', 'Georgia', 'Verdana', 'Helvetica'].map((f) => (
            <option key={f} value={f}>{f}</option>
          ))}
        </select>
        <button
          onClick={() => onToolOptionChange('fontBold', !toolOptions.fontBold)}
          className={cn('w-7 h-7 rounded font-bold text-sm transition-colors', toolOptions.fontBold ? 'bg-blue-500 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}
          title="Bold"
        >B</button>
        <button
          onClick={() => onToolOptionChange('fontItalic', !toolOptions.fontItalic)}
          className={cn('w-7 h-7 rounded italic text-sm transition-colors', toolOptions.fontItalic ? 'bg-blue-500 text-white' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700')}
          title="Italic"
        >I</button>
      </div>

      <Divider />

      {/* Zoom */}
      <div className="flex items-center gap-1">
        <ToolBtn icon={<ZoomOut size={16} />} label="Zoom Out" onClick={() => onZoomChange(Math.max(0.25, zoom - 0.25))} />
        <span className="text-xs text-zinc-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
        <ToolBtn icon={<ZoomIn size={16} />} label="Zoom In" onClick={() => onZoomChange(Math.min(3, zoom + 0.25))} />
        <ToolBtn icon={<RotateCcw size={14} />} label="Reset Zoom" onClick={() => onZoomChange(1)} />
      </div>

      <Divider />

      {/* Document actions */}
      <ToolBtn icon={<Search size={16} />} label="Search & Replace (Ctrl+F)" onClick={onSearch} />
      <ToolBtn icon={<FileStack size={16} />} label="Page Manager" onClick={onPageManager} />
      <ToolBtn icon={<Droplets size={16} />} label="Watermark" onClick={onWatermark} />

      <Divider />

      <button
        onClick={onExport}
        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors ml-auto"
      >
        <Download size={14} />
        Download PDF
      </button>
    </div>
  );
}
