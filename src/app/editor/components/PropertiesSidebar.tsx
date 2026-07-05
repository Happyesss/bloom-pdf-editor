import React, { MutableRefObject } from 'react';
import { 
  Type, TextCursorInput, Image, PenTool, Highlighter, Eraser, MousePointer2, 
  X, Trash2, Bold, Italic, AlignLeft, AlignCenter, AlignRight, Minus, Plus 
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
}

export function PropertiesSidebar(props: PropertiesSidebarProps) {
  const {
    activeTool, setActiveTool, selectedRun,
    textFontFamily, setTextFontFamily, textFontSize, setTextFontSize,
    textBold, setTextBold, textItalic, setTextItalic, textColor, setTextColor,
    textAlign, setTextAlign, textOpacity, setTextOpacity,
    replacingImageIdRef, fileInputRef,
    drawColor, setDrawColor, drawSize, setDrawSize,
    highlightColor, setHighlightColor, highlightSize, setHighlightSize,
    eraserSize, setEraserSize,
    selectedDisplayItem, setSelectedDisplayItem, displayItems
  } = props;

  if (!['text', 'addtext', 'draw', 'highlight', 'erase', 'select'].includes(activeTool)) return null;

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
              >
                <Bold size={14} /> Bold
              </button>
              <button
                onClick={() => setTextItalic(i => !i)}
                className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${textItalic ? 'bg-blue-600/20 text-blue-400 border border-blue-500/50' : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'}`}
              >
                <Italic size={14} /> Italic
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
            <div className="grid grid-cols-4 gap-2 p-2 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
              {['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f4f4f5'].map(color => (
                <button
                  key={color}
                  onClick={() => setDrawColor(color)}
                  className={`w-6 h-6 rounded-full mx-auto transition-transform ${drawColor === color ? 'scale-125 ring-2 ring-zinc-300 ring-offset-2 ring-offset-zinc-900' : 'hover:scale-110'}`}
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
            <div className="grid grid-cols-4 gap-2 p-2 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
              {['#fffb00', '#00ff00', '#00e5ff', '#ff00ff', '#ff8c00', '#ff6b6b', '#a78bfa', '#67e8f9'].map(color => (
                <button
                  key={color}
                  onClick={() => setHighlightColor(color)}
                  className={`w-6 h-6 rounded-full mx-auto transition-transform ${highlightColor === color ? 'scale-125 ring-2 ring-zinc-300 ring-offset-2 ring-offset-zinc-900' : 'hover:scale-110'}`}
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
    </div>
  );
}
