import React, { MutableRefObject } from 'react';
import {
  Type, TextCursorInput, Image, PenTool, Highlighter, Eraser, MousePointer2,
  X, Trash2, Bold, Italic, Underline, AlignLeft, AlignCenter, AlignRight, Minus, Plus, Stamp
} from 'lucide-react';
import type { EditorTool } from '../types';
import type { TextRun, ImageItem, PathItem } from '@/engine';

interface PropertiesSidebarProps {
  activeTool: EditorTool;
  setActiveTool: (tool: EditorTool) => void;
  selectedRun: TextRun | null;

  textFontFamily: string;
  setTextFontFamily: (v: string) => void;
  textFontSize: number;
  setTextFontSize: (v: number | ((prev: number) => number)) => void;
  textBold: boolean;
  setTextBold: (v: boolean | ((prev: boolean) => boolean)) => void;
  textItalic: boolean;
  setTextItalic: (v: boolean | ((prev: boolean) => boolean)) => void;
  textUnderline: boolean;
  setTextUnderline: (v: boolean | ((prev: boolean) => boolean)) => void;
  textColor: string;
  setTextColor: (v: string) => void;
  textAlign: 'left' | 'center' | 'right';
  setTextAlign: (v: 'left' | 'center' | 'right') => void;
  textOpacity: number;
  setTextOpacity: (v: number) => void;

  replacingImageIdRef: MutableRefObject<string | null>;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;

  drawColor: string;
  setDrawColor: (v: string) => void;
  drawSize: number;
  setDrawSize: (v: number) => void;

  highlightColor: string;
  setHighlightColor: (v: string) => void;
  highlightSize: number;
  setHighlightSize: (v: number) => void;

  eraserSize: number;
  setEraserSize: (v: number) => void;

  selectedDisplayItem: ImageItem | PathItem | null;
  setSelectedDisplayItem: (item: ImageItem | PathItem | null) => void;
  displayItems: (ImageItem | PathItem)[];

  watermarkText?: string;
  setWatermarkText?: (v: string) => void;
  watermarkFontName?: string;
  setWatermarkFontName?: (v: string) => void;
  watermarkOpacity?: number;
  setWatermarkOpacity?: (v: number) => void;
  watermarkRotation?: number;
  setWatermarkRotation?: (v: number) => void;
  watermarkSize?: number;
  setWatermarkSize?: (v: number) => void;
  watermarkPosition?: string;
  setWatermarkPosition?: (v: string) => void;
  watermarkMosaic?: boolean;
  setWatermarkMosaic?: (v: boolean) => void;
  watermarkPageFrom?: number;
  setWatermarkPageFrom?: (v: number) => void;
  watermarkPageTo?: number;
  setWatermarkPageTo?: (v: number) => void;
  watermarkLayer?: 'above' | 'below';
  setWatermarkLayer?: (v: 'above' | 'below') => void;
  watermarkColor?: string;
  setWatermarkColor?: (v: string) => void;
  watermarkType?: 'text' | 'image';
  setWatermarkType?: (v: 'text' | 'image') => void;
  watermarkImageFile?: File | null;
  onWatermarkImageUpload?: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onApplyWatermark?: () => void;
  onRemoveWatermarks?: () => void;
}

export function PropertiesSidebar(props: PropertiesSidebarProps) {
  const {
    activeTool, setActiveTool, selectedRun,
    textFontFamily, setTextFontFamily, textFontSize, setTextFontSize,
    textBold, setTextBold, textItalic, setTextItalic, textUnderline, setTextUnderline, textColor, setTextColor,
    textAlign, setTextAlign, textOpacity, setTextOpacity,
    replacingImageIdRef, fileInputRef,
    drawColor, setDrawColor, drawSize, setDrawSize,
    highlightColor, setHighlightColor, highlightSize, setHighlightSize,
    eraserSize, setEraserSize,
    selectedDisplayItem, setSelectedDisplayItem, displayItems,
    watermarkType = 'text', setWatermarkType,
    watermarkImageFile = null, onWatermarkImageUpload,
    watermarkText = 'Bloom PDF', setWatermarkText,
    watermarkFontName = 'Arial', setWatermarkFontName,
    watermarkOpacity = 25, setWatermarkOpacity,
    watermarkRotation = 45, setWatermarkRotation,
    watermarkSize = 100, setWatermarkSize,
    watermarkPosition = 'center', setWatermarkPosition,
    watermarkMosaic = false, setWatermarkMosaic,
    watermarkPageFrom = 1, setWatermarkPageFrom,
    watermarkPageTo = 1, setWatermarkPageTo,
    watermarkLayer = 'above', setWatermarkLayer,
    watermarkColor = '#000000', setWatermarkColor,
    onApplyWatermark, onRemoveWatermarks
  } = props;

  if (!['text', 'addtext', 'draw', 'highlight', 'erase', 'select', 'watermark'].includes(activeTool)) return null;

  return (
    <div className="w-64 bg-zinc-900/95 backdrop-blur-md border-r border-zinc-800/80 flex flex-col shrink-0 z-10 overflow-y-auto shadow-[4px_0_24px_rgba(0,0,0,0.2)]">
      {/* TEXT TOOL PROPERTIES */}
      {(activeTool === 'text' || activeTool === 'addtext') && (
        <div className="p-4 space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
            <Type size={14} />
            Text Properties
          </div>

          {/* Selected run info */}
          {selectedRun && (
            <div className="bg-zinc-800/60 rounded-lg p-2.5 text-[11px] text-zinc-400 border border-zinc-700/50">
              <span className="text-zinc-200 font-medium">Editing:</span>{' '}
              &quot;{selectedRun.text.substring(0, 40)}{selectedRun.text.length > 40 ? '…' : ''}&quot;
            </div>
          )}

          {/* Font Family */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Font</label>
            <select
              value={textFontFamily}
              onChange={(e) => setTextFontFamily(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none focus:border-blue-500 transition-colors cursor-pointer appearance-none"
            >
              <option value="Helvetica">Helvetica</option>
              <option value="Times-Roman">Times Roman</option>
              <option value="Courier">Courier</option>
              <option value="Arial">Arial</option>
              <option value="Georgia">Georgia</option>
              <option value="Verdana">Verdana</option>
              <option value="Trebuchet MS">Trebuchet MS</option>
              <option value="Palatino">Palatino</option>
            </select>
          </div>

          {/* Font Size */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Size</label>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setTextFontSize(s => Math.max(4, s - 1))}
                className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-md text-zinc-400 transition-colors border border-zinc-700"
              >
                <Minus size={12} />
              </button>
              <input
                type="number"
                value={textFontSize}
                onChange={(e) => setTextFontSize(Math.max(4, Math.min(200, parseInt(e.target.value) || 12)))}
                className="w-16 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 text-center outline-none focus:border-blue-500"
              />
              <button
                onClick={() => setTextFontSize(s => Math.min(200, s + 1))}
                className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-md text-zinc-400 transition-colors border border-zinc-700"
              >
                <Plus size={12} />
              </button>
            </div>
            <div className="flex flex-wrap gap-1 mt-1.5">
              {[8, 10, 12, 14, 16, 18, 24, 36, 48, 72].map(s => (
                <button
                  key={s}
                  onClick={() => setTextFontSize(s)}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${textFontSize === s ? 'bg-blue-600 text-white shadow-sm' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border border-zinc-700/50'}`}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Style */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Style</label>
            <div className="flex gap-2">
              <button
                onClick={() => setTextBold(b => !b)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${textBold ? 'bg-blue-600/20 text-blue-400 border border-blue-500/50' : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'}`}
                title="Bold"
              >
                <Bold size={16} />
              </button>
              <button
                onClick={() => setTextItalic(i => !i)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${textItalic ? 'bg-blue-600/20 text-blue-400 border border-blue-500/50' : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'}`}
                title="Italic"
              >
                <Italic size={16} />
              </button>
              <button
                onClick={() => setTextUnderline(u => !u)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${textUnderline ? 'bg-blue-600/20 text-blue-400 border border-blue-500/50' : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'}`}
                title="Underline"
              >
                <Underline size={16} />
              </button>
            </div>
          </div>

          {/* Color */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={textColor}
                onChange={(e) => setTextColor(e.target.value)}
                className="w-8 h-8 rounded-lg border border-zinc-700 cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={textColor.toUpperCase()}
                onChange={(e) => {
                  let val = e.target.value;
                  if (!val.startsWith('#')) val = '#' + val;
                  setTextColor(val);
                }}
                className="w-16 bg-transparent border-b border-zinc-700 text-[11px] text-zinc-300 font-mono focus:outline-none focus:border-blue-500 uppercase pb-0.5"
                maxLength={7}
              />
            </div>
            <div className="flex gap-1.5 mt-1">
              {['#000000', '#ffffff', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#6b7280'].map(c => (
                <button
                  key={c}
                  onClick={() => setTextColor(c)}
                  className={`w-5 h-5 rounded-full border-2 transition-transform ${textColor.toLowerCase() === c ? 'scale-125 border-blue-400' : 'border-zinc-700 hover:scale-110'}`}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </div>

          {/* Alignment */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Alignment</label>
            <div className="flex gap-1 bg-zinc-800 p-1 rounded-lg border border-zinc-700">
              {([
                { val: 'left' as const, icon: <AlignLeft size={14} /> },
                { val: 'center' as const, icon: <AlignCenter size={14} /> },
                { val: 'right' as const, icon: <AlignRight size={14} /> },
              ]).map(a => (
                <button
                  key={a.val}
                  onClick={() => setTextAlign(a.val)}
                  className={`flex-1 py-1.5 rounded-md flex items-center justify-center transition-all ${textAlign === a.val ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
                >
                  {a.icon}
                </button>
              ))}
            </div>
          </div>

          {/* Opacity */}
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Opacity</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="0" max="100"
                value={textOpacity}
                onChange={(e) => setTextOpacity(parseInt(e.target.value))}
                className="flex-1 accent-blue-500"
              />
              <span className="text-[11px] text-zinc-400 w-8 text-right font-mono">{textOpacity}%</span>
            </div>
          </div>

          {/* Add Content */}
          <div className="pt-4 mt-4 border-t border-zinc-800/80 space-y-2">
            <div className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase mb-2">
              Add Content
            </div>
            <button
              onClick={() => setActiveTool('addtext')}
              className={`w-full flex items-center justify-center gap-2 py-2 rounded-md transition-colors text-xs font-semibold ${activeTool === 'addtext' ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}`}
            >
              <TextCursorInput size={14} />
              Add Text Box
            </button>
            <button
              onClick={() => {
                replacingImageIdRef.current = null;
                if (fileInputRef.current) {
                  fileInputRef.current.click();
                }
              }}
              className="w-full flex items-center justify-center gap-2 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md transition-colors text-xs font-semibold"
            >
              <Image size={14} />
              Add Image
            </button>
          </div>
        </div>
      )}

      {/* DRAW TOOL PROPERTIES */}
      {activeTool === 'draw' && (
        <div className="p-4 space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
            <PenTool size={14} />
            Draw Properties
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={drawColor}
                onChange={(e) => setDrawColor(e.target.value)}
                className="w-8 h-8 rounded-lg border border-zinc-700 cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={drawColor.toUpperCase()}
                onChange={(e) => {
                  let val = e.target.value;
                  if (!val.startsWith('#')) val = '#' + val;
                  setDrawColor(val);
                }}
                className="w-16 bg-transparent border-b border-zinc-700 text-[11px] text-zinc-300 font-mono focus:outline-none focus:border-blue-500 uppercase pb-0.5"
                maxLength={7}
              />
            </div>
            <div className="grid grid-cols-4 gap-2 p-2 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
              {['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f4f4f5'].map(color => (
                <button
                  key={color}
                  onClick={() => setDrawColor(color)}
                  className={`w-6 h-6 rounded-full mx-auto transition-transform ${drawColor.toLowerCase() === color.toLowerCase() ? 'scale-125 ring-2 ring-zinc-300 ring-offset-2 ring-offset-zinc-900' : 'hover:scale-110'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Brush Size</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="1" max="20"
                value={drawSize}
                onChange={(e) => setDrawSize(parseInt(e.target.value))}
                className="flex-1 accent-blue-500"
              />
              <span className="text-[11px] text-zinc-400 w-8 text-right font-mono">{drawSize}px</span>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] text-zinc-500">Preview:</span>
            <div
              className="rounded-full"
              style={{ width: drawSize + 4, height: drawSize + 4, backgroundColor: drawColor }}
            />
          </div>
        </div>
      )}

      {/* HIGHLIGHT TOOL PROPERTIES */}
      {activeTool === 'highlight' && (
        <div className="p-4 space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
            <Highlighter size={14} />
            Highlight Properties
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Color</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={highlightColor}
                onChange={(e) => setHighlightColor(e.target.value)}
                className="w-8 h-8 rounded-lg border border-zinc-700 cursor-pointer bg-transparent"
              />
              <input
                type="text"
                value={highlightColor.toUpperCase()}
                onChange={(e) => {
                  let val = e.target.value;
                  if (!val.startsWith('#')) val = '#' + val;
                  setHighlightColor(val);
                }}
                className="w-16 bg-transparent border-b border-zinc-700 text-[11px] text-zinc-300 font-mono focus:outline-none focus:border-blue-500 uppercase pb-0.5"
                maxLength={7}
              />
            </div>
            <div className="grid grid-cols-4 gap-2 p-2 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
              {['#fffb00', '#00ff00', '#00e5ff', '#ff00ff', '#ff8c00', '#ff6b6b', '#a78bfa', '#67e8f9'].map(color => (
                <button
                  key={color}
                  onClick={() => setHighlightColor(color)}
                  className={`w-6 h-6 rounded-full mx-auto transition-transform ${highlightColor.toLowerCase() === color.toLowerCase() ? 'scale-125 ring-2 ring-zinc-300 ring-offset-2 ring-offset-zinc-900' : 'hover:scale-110'}`}
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Thickness</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="5" max="40"
                value={highlightSize}
                onChange={(e) => setHighlightSize(parseInt(e.target.value))}
                className="flex-1 accent-yellow-400"
              />
              <span className="text-[11px] text-zinc-400 w-8 text-right font-mono">{highlightSize}px</span>
            </div>
          </div>
        </div>
      )}

      {/* ERASER PROPERTIES */}
      {activeTool === 'erase' && (
        <div className="p-4 space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
            <Eraser size={14} />
            Eraser Properties
          </div>
          <div className="space-y-1.5">
            <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Eraser Size</label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min="5" max="50"
                value={eraserSize}
                onChange={(e) => setEraserSize(parseInt(e.target.value))}
                className="flex-1 accent-zinc-400"
              />
              <span className="text-[11px] text-zinc-400 w-8 text-right font-mono">{eraserSize}px</span>
            </div>
          </div>
          <div className="flex items-center gap-2 pt-1">
            <span className="text-[10px] text-zinc-500">Preview:</span>
            <div
              className="rounded-full border-2 border-zinc-500"
              style={{ width: eraserSize, height: eraserSize, backgroundColor: 'rgba(255,255,255,0.15)' }}
            />
          </div>
        </div>
      )}

      {/* SELECT TOOL — SELECTED IMAGE/SIGNATURE INFO */}
      {activeTool === 'select' && selectedDisplayItem && (
        <div className="p-4 space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
            {selectedDisplayItem.type === 'image' ? <Image size={14} /> : <PenTool size={14} />}
            {selectedDisplayItem.type === 'image' ? 'Image Properties' : 'Drawing / Signature'}
          </div>
          <div className="space-y-2 text-[11px]">
            <div className="flex justify-between bg-zinc-800/50 rounded-md px-3 py-2 border border-zinc-700/50">
              <span className="text-zinc-500">Type</span>
              <span className="text-zinc-200 font-medium capitalize">{selectedDisplayItem.type}</span>
            </div>
            <div className="flex justify-between bg-zinc-800/50 rounded-md px-3 py-2 border border-zinc-700/50">
              <span className="text-zinc-500">Position</span>
              <span className="text-zinc-200 font-mono">{Math.round(selectedDisplayItem.x)}, {Math.round(selectedDisplayItem.y)}</span>
            </div>
            <div className="flex justify-between bg-zinc-800/50 rounded-md px-3 py-2 border border-zinc-700/50">
              <span className="text-zinc-500">Size</span>
              <span className="text-zinc-200 font-mono">{Math.round(selectedDisplayItem.width)} × {Math.round(selectedDisplayItem.height)} pt</span>
            </div>
          </div>
          <div className="space-y-2 pt-2">
            <button
              onClick={() => setSelectedDisplayItem(null)}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 transition-colors"
            >
              <X size={12} /> Deselect
            </button>
            <button
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
            >
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </div>
      )}

      {/* SELECT TOOL — NO SELECTION */}
      {activeTool === 'select' && !selectedDisplayItem && (
        <div className="p-4 space-y-3 animate-in fade-in slide-in-from-left-4 duration-300">
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
            <MousePointer2 size={14} />
            Select Tool
          </div>
          <p className="text-[11px] text-zinc-500 leading-relaxed">
            Click on images or drawings to select them. Double-click text to edit.
          </p>
          {displayItems.length > 0 && (
            <div className="bg-zinc-800/50 rounded-lg p-2.5 border border-zinc-700/50">
              <span className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Detected</span>
              <div className="flex gap-3 mt-2">
                <span className="text-[11px] text-blue-400">
                  {displayItems.filter(d => d.type === 'image').length} images
                </span>
                <span className="text-[11px] text-green-400">
                  {displayItems.filter(d => d.type === 'path').length} drawings
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* WATERMARK PROPERTIES */}
      {activeTool === 'watermark' && (
        <div className="flex flex-col h-full bg-zinc-900/95 animate-in fade-in slide-in-from-left-4 duration-300">
          <div className="flex border-b border-zinc-700/50">
            <button
              onClick={() => setWatermarkType?.('text')}
              className={`flex-1 py-4 flex flex-col items-center gap-2 text-[11px] font-medium transition-colors ${watermarkType === 'text' ? 'text-zinc-100 bg-zinc-800/50' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              <div className={`text-2xl font-serif ${watermarkType === 'text' ? 'border-b-2 border-zinc-200 text-zinc-200' : 'border-b-2 border-zinc-500 text-zinc-500'}`}>A</div>
              Place text
            </button>
            <button
              onClick={() => setWatermarkType?.('image')}
              className={`flex-1 py-4 flex flex-col items-center gap-2 text-[11px] font-medium relative transition-colors ${watermarkType === 'image' ? 'text-zinc-100 bg-zinc-800/50' : 'text-zinc-400 hover:text-zinc-200'}`}
            >
              {watermarkType === 'image' && <div className="absolute top-2 left-4 w-3 h-3 bg-green-500 rounded-full flex items-center justify-center text-white text-[8px]">✓</div>}
              <Image size={24} className={watermarkType === 'image' ? 'text-zinc-200' : 'text-zinc-500'} />
              Place image
            </button>
          </div>

          <div className="p-4 space-y-5 overflow-y-auto flex-1">
            {watermarkType === 'text' ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-zinc-300">Text:</label>
                  <input
                    type="text"
                    value={watermarkText}
                    onChange={(e) => setWatermarkText?.(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-200 outline-none focus:border-blue-500 transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-zinc-300">Text format:</label>
                  <select
                    value={watermarkFontName}
                    onChange={(e) => setWatermarkFontName?.(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-200 outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer"
                  >
                    <option value="Arial">Arial</option>
                    <option value="Helvetica">Helvetica</option>
                    <option value="Times-Roman">Times Roman</option>
                    <option value="Courier">Courier</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[11px] font-medium text-zinc-300">Color:</label>
                  <div className="flex items-center gap-3">
                    <input
                      type="color"
                      value={watermarkColor}
                      onChange={(e) => setWatermarkColor?.(e.target.value)}
                      className="w-8 h-8 cursor-pointer rounded overflow-hidden"
                    />
                    <span className="text-[11px] text-zinc-400 font-mono uppercase">{watermarkColor}</span>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex justify-center relative">
                <button 
                  onClick={() => {
                    const fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.accept = 'image/png, image/jpeg';
                    fileInput.onchange = (e) => onWatermarkImageUpload?.(e as any);
                    fileInput.click();
                  }}
                  className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-8 py-3 rounded text-xs font-medium transition-colors"
                >
                  <Image size={16} /> ADD IMAGE
                </button>
                {watermarkImageFile && (
                  <p className="text-[10px] text-green-400 mt-2 truncate w-full text-center absolute top-12">
                    Loaded: {watermarkImageFile.name}
                  </p>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-zinc-300">Position:</label>
              <div className="flex items-start gap-4">
                <div className="grid grid-cols-3 grid-rows-3 gap-0 border border-zinc-600 w-16 h-16 relative">
                  {(['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right'] as const).map((pos) => (
                    <button
                      key={pos}
                      onClick={() => setWatermarkPosition?.(pos)}
                      className="border border-zinc-600/50 flex items-center justify-center hover:bg-zinc-700/50 transition-colors"
                    >
                      {(watermarkPosition === pos || watermarkMosaic) && <div className="w-3 h-3 bg-red-500 rounded-full" />}
                    </button>
                  ))}
                </div>
                <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer pt-1">
                  <input
                    type="checkbox"
                    checked={watermarkMosaic}
                    onChange={(e) => setWatermarkMosaic?.(e.target.checked)}
                    className="rounded border-zinc-700 bg-zinc-800 text-blue-500 cursor-pointer"
                  />
                  Mosaic
                </label>
              </div>
            </div>

            <div className="flex gap-4">
              <div className="space-y-1.5 flex-1">
                <label className="text-[11px] font-medium text-zinc-300">Transparency:</label>
                <select
                  value={watermarkOpacity === 100 ? 'No transparency' : `${100 - watermarkOpacity}%`}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'No transparency') setWatermarkOpacity?.(100);
                    else setWatermarkOpacity?.(100 - parseInt(val));
                  }}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-2 text-[11px] text-zinc-200 outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer"
                >
                  <option value="No transparency">No transparency</option>
                  <option value="25%">25%</option>
                  <option value="50%">50%</option>
                  <option value="75%">75%</option>
                </select>
              </div>
              <div className="space-y-1.5 flex-1">
                <label className="text-[11px] font-medium text-zinc-300">Rotation:</label>
                <select
                  value={watermarkRotation === 0 ? 'Do not rotate' : `${watermarkRotation} degrees`}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === 'Do not rotate') setWatermarkRotation?.(0);
                    else setWatermarkRotation?.(parseInt(val));
                  }}
                  className="w-full bg-zinc-800 border border-zinc-700 rounded px-2 py-2 text-[11px] text-zinc-200 outline-none focus:border-blue-500 transition-colors appearance-none cursor-pointer"
                >
                  <option value="Do not rotate">Do not rotate</option>
                  <option value="45 degrees">45 degrees</option>
                  <option value="90 degrees">90 degrees</option>
                  <option value="180 degrees">180 degrees</option>
                  <option value="270 degrees">270 degrees</option>
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center justify-between text-[11px] font-medium text-zinc-300">
                Size
                <span className="text-zinc-400 font-mono">{watermarkSize}%</span>
              </label>
              <input
                type="range"
                min="10"
                max="300"
                value={watermarkSize}
                onChange={(e) => setWatermarkSize?.(parseInt(e.target.value))}
                className="w-full accent-blue-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-zinc-300">Pages:</label>
              <div className="flex items-center gap-2">
                <div className="flex items-center border border-zinc-700 rounded bg-zinc-800">
                  <span className="px-2 text-[11px] text-zinc-400 border-r border-zinc-700">from page</span>
                  <input
                    type="number"
                    min="1"
                    value={watermarkPageFrom}
                    onChange={(e) => setWatermarkPageFrom?.(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-12 bg-transparent py-1.5 text-xs text-center text-zinc-200 outline-none"
                  />
                </div>
                <div className="flex items-center border border-zinc-700 rounded bg-zinc-800">
                  <span className="px-2 text-[11px] text-zinc-400 border-r border-zinc-700">to</span>
                  <input
                    type="number"
                    min="1"
                    value={watermarkPageTo}
                    onChange={(e) => setWatermarkPageTo?.(Math.max(1, parseInt(e.target.value) || 1))}
                    className="w-12 bg-transparent py-1.5 text-xs text-center text-zinc-200 outline-none"
                  />
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-[11px] font-medium text-zinc-300">Layer</label>
              <div className="flex gap-2">
                <button
                  onClick={() => setWatermarkLayer?.('above')}
                  className={`flex-1 py-6 flex flex-col items-center justify-center gap-2 rounded border transition-colors ${watermarkLayer === 'above' ? 'bg-zinc-800/80 border-red-500/50 text-red-400' : 'bg-zinc-800/40 border-zinc-700/50 text-zinc-500 hover:text-zinc-300'}`}
                >
                  <div className="rotate-45 w-4 h-4 bg-current" />
                  <span className="text-[10px] text-center px-2">Over the PDF content</span>
                </button>
                <button
                  onClick={() => setWatermarkLayer?.('below')}
                  className={`flex-1 py-6 flex flex-col items-center justify-center gap-2 rounded border transition-colors ${watermarkLayer === 'below' ? 'bg-zinc-800/80 border-red-500/50 text-red-400' : 'bg-zinc-800/40 border-zinc-700/50 text-zinc-500 hover:text-zinc-300'}`}
                >
                  <div className="rotate-45 w-4 h-4 border-2 border-current" />
                  <span className="text-[10px] text-center px-2">Below the PDF content</span>
                </button>
              </div>
            </div>

            <div className="pt-2 flex flex-col gap-2 pb-4">
              <button
                onClick={onApplyWatermark}
                className="w-full bg-red-600 hover:bg-red-700 text-white rounded py-2.5 text-xs font-semibold transition-colors"
              >
                Add watermark
              </button>
              <button
                onClick={onRemoveWatermarks}
                className="w-full bg-zinc-800 hover:bg-red-900/50 hover:text-red-400 text-zinc-300 border border-zinc-700 hover:border-red-800/50 rounded py-2 text-xs font-semibold transition-colors"
              >
                Scan &amp; Remove All
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
