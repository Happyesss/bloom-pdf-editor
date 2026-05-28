'use client';

import { cn } from '@/lib/utils';
import type { ToolType, ToolOptions } from '@/types/editor';
import {
  MousePointer2, Type, Pen, Highlighter, Minus, Square, Circle,
  Image, PenLine, Trash2, Eraser, ZoomIn, ZoomOut, RotateCcw, Download,
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
  onDeleteSelected: () => void;
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
  description?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

function ToolBtn({ icon, label, description, active, disabled, onClick }: ToolButtonProps) {
  return (
    <div className="relative group/tb">
      <button
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
      {/* Custom hover tooltip */}
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover/tb:opacity-100 transition-opacity duration-150 pointer-events-none z-[100] flex flex-col items-center">
        <div className="bg-zinc-900 border border-zinc-700 rounded-lg px-2.5 py-1.5 shadow-2xl text-center max-w-[180px]">
          <div className="text-xs font-semibold text-white whitespace-nowrap">{label}</div>
          {description && <div className="text-[10px] text-zinc-400 mt-0.5 whitespace-nowrap">{description}</div>}
        </div>
        <div className="w-2.5 h-2.5 bg-zinc-900 border-r border-b border-zinc-700 rotate-45 -mt-[5px]" />
      </div>
    </div>
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
  onDeleteSelected,
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
      <ToolBtn icon={<Undo2 size={16} />} label="Undo" description="Undo last action (Ctrl+Z)" disabled={!canUndo} onClick={onUndo} />
      <ToolBtn icon={<Redo2 size={16} />} label="Redo" description="Redo last undone action (Ctrl+Y)" disabled={!canRedo} onClick={onRedo} />

      {/* Delete — full button (high-discoverability per UX audit) */}
      <button
        onClick={onDeleteSelected}
        title="Delete selected object (Del)"
        className="flex items-center gap-1.5 h-9 px-2.5 rounded-lg text-xs font-medium text-red-300 hover:text-white hover:bg-red-500/80 transition-colors"
      >
        <Trash2 size={14} />
        <span className="hidden md:inline">Delete</span>
      </button>

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
      <ToolBtn icon={<MousePointer2 size={16} />} label="Select" description="Select & move objects (V)" active={activeTool === 'select'} onClick={() => onToolChange('select')} />
      <ToolBtn icon={<Type size={16} />} label="Add Text" description="Insert a text box (T)" active={activeTool === 'text'} onClick={() => onToolChange('text')} />
      <ToolBtn icon={<Pen size={16} />} label="Draw" description="Freehand drawing (D)" active={activeTool === 'draw'} onClick={() => onToolChange('draw')} />
      <ToolBtn icon={<Eraser size={14} />} label="Eraser" description="Erase drawn marks (E)" active={activeTool === 'eraser'} onClick={() => onToolChange('eraser')} />

      <Divider />

      {/* Shapes */}
      <ToolBtn icon={<Square size={16} />} label="Rectangle" description="Draw a rectangle shape" active={activeTool === 'rectangle'} onClick={() => onToolChange('rectangle')} />
      <ToolBtn icon={<Circle size={16} />} label="Ellipse" description="Draw an ellipse / circle" active={activeTool === 'ellipse'} onClick={() => onToolChange('ellipse')} />
      <ToolBtn icon={<Minus size={16} />} label="Line" description="Draw a straight line" active={activeTool === 'line'} onClick={() => onToolChange('line')} />
      <ToolBtn icon={<ArrowRight size={16} />} label="Arrow" description="Draw an arrow" active={activeTool === 'arrow'} onClick={() => onToolChange('arrow')} />

      <Divider />

      {/* Annotations */}
      <ToolBtn icon={<Highlighter size={16} />} label="Highlight" description="Highlight text (H)" active={activeTool === 'highlight'} onClick={() => onToolChange('highlight')} />
      <ToolBtn icon={<Underline size={16} />} label="Underline" description="Draw an underline" active={activeTool === 'underline'} onClick={() => onToolChange('underline')} />
      <ToolBtn icon={<Strikethrough size={16} />} label="Strikethrough" description="Draw a strikethrough" active={activeTool === 'strikethrough'} onClick={() => onToolChange('strikethrough')} />
      <ToolBtn icon={<MessageSquare size={14} />} label="Comment" description="Add a sticky comment note" active={activeTool === 'comment'} onClick={() => onToolChange('comment')} />

      <Divider />

      {/* Advanced */}
      <ToolBtn icon={<PenLine size={16} />} label="Signature" description="Draw or insert a signature (S)" active={activeTool === 'signature'} onClick={onSignature} />
      <ToolBtn icon={<Image size={16} />} label="Insert Image" description="Add an image to the page" onClick={onImageInsert} />
      <ToolBtn icon={<Trash2 size={15} />} label="Redact" description="Black-out / redact an area" active={activeTool === 'redact'} onClick={() => onToolChange('redact')} />

      {/* Stamp tool with picker */}
      <div className="relative">
        <ToolBtn
          icon={<Stamp size={16} />}
          label="Stamp"
          description="Place a pre-set stamp on the page"
          active={activeTool === 'stamp'}
          onClick={() => onToolChange(activeTool === 'stamp' ? 'select' : 'stamp')}
        />
        {activeTool === 'stamp' && (
          <div className="absolute top-full left-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-xl p-2 z-50 shadow-2xl grid grid-cols-2 gap-1 min-w-[172px]">
            <div className="col-span-2 text-[10px] text-zinc-500 font-semibold uppercase px-1 pb-0.5">Choose stamp</div>
            {([
              { id: 'APPROVED', label: 'Approved', color: '#16a34a' },
              { id: 'REJECTED', label: 'Rejected', color: '#dc2626' },
              { id: 'DRAFT', label: 'Draft', color: '#9ca3af' },
              { id: 'CONFIDENTIAL', label: 'Confidential', color: '#dc2626' },
              { id: 'VOID', label: 'Void', color: '#dc2626' },
              { id: 'PAID', label: 'Paid', color: '#16a34a' },
            ] as { id: string; label: string; color: string }[]).map((s) => (
              <button
                key={s.id}
                onClick={() => onToolOptionChange('stampType', s.id as ToolOptions['stampType'])}
                style={{ borderColor: (toolOptions.stampType ?? 'APPROVED') === s.id ? s.color : undefined, color: s.color }}
                className={cn(
                  'px-2 py-1 text-[11px] rounded-lg border font-bold transition-colors hover:opacity-80',
                  (toolOptions.stampType ?? 'APPROVED') === s.id
                    ? 'bg-zinc-700'
                    : 'border-zinc-600 bg-transparent hover:bg-zinc-700'
                )}
              >{s.label}</button>
            ))}
          </div>
        )}
      </div>

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
        <ToolBtn icon={<ZoomOut size={16} />} label="Zoom Out" description="Decrease zoom level" onClick={() => onZoomChange(Math.max(0.25, zoom - 0.25))} />
        <span className="text-xs text-zinc-400 w-12 text-center">{Math.round(zoom * 100)}%</span>
        <ToolBtn icon={<ZoomIn size={16} />} label="Zoom In" description="Increase zoom level" onClick={() => onZoomChange(Math.min(3, zoom + 0.25))} />
        <ToolBtn icon={<RotateCcw size={14} />} label="Reset Zoom" description="Reset to 100%" onClick={() => onZoomChange(1)} />
      </div>

      <Divider />

      {/* Document actions */}
      <ToolBtn icon={<Search size={16} />} label="Search" description="Find text in document (Ctrl+F)" onClick={onSearch} />
      <ToolBtn icon={<FileStack size={16} />} label="Page Manager" description="Reorder, rotate or delete pages" onClick={onPageManager} />
      <ToolBtn icon={<Droplets size={16} />} label="Watermark" description="Add a watermark to all pages" onClick={onWatermark} />

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
