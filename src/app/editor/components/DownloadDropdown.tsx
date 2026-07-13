'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Download,
  ChevronDown,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Info,
  Gauge,
  HardDrive,
  Target,
} from 'lucide-react';
import type { PDFDocumentData } from '@/engine';
import {
  estimateDocumentSize,
  evaluateTargetSize,
  formatFileSize,
  parseFileSize,
  type SizeEstimation,
} from '../export-formats';

// ─── Props ──────────────────────────────────────────────────────────────────────

interface DownloadDropdownProps {
  isSaving: boolean;
  onDownload: () => void;
  saveMode: 'quick' | 'optimized';
  onSaveModeChange: (mode: 'quick' | 'optimized') => void;
  doc: PDFDocumentData | null;
  /** Custom download with compression target. */
  onCompressedDownload?: (targetBytes: number, quality: number) => void;
}

// ─── DPI Presets ────────────────────────────────────────────────────────────────

const DPI_PRESETS = [
  { value: 72, label: 'Screen', desc: '72 DPI — Smallest file' },
  { value: 150, label: 'Standard', desc: '150 DPI — Good balance' },
  { value: 300, label: 'Print', desc: '300 DPI — Print quality' },
  { value: 600, label: 'High', desc: '600 DPI — Maximum detail' },
];

// ─── Component ──────────────────────────────────────────────────────────────────

export function DownloadDropdown({
  isSaving,
  onDownload,
  onSaveModeChange,
  doc,
  onCompressedDownload,
  saveMode,
}: DownloadDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [selectedDpi, setSelectedDpi] = useState(150);
  const [compressionQuality, setCompressionQuality] = useState(80);
  const [targetSizeInput, setTargetSizeInput] = useState('');
  const [sizeEstimation, setSizeEstimation] = useState<SizeEstimation | null>(null);
  const [targetEstimation, setTargetEstimation] = useState<SizeEstimation | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && doc) {
      setSizeEstimation(estimateDocumentSize(doc));
    }
  }, [isOpen, doc]);

  useEffect(() => {
    if (!sizeEstimation || !targetSizeInput.trim()) {
      setTargetEstimation(null);
      return;
    }
    const targetBytes = parseFileSize(targetSizeInput);
    if (targetBytes === null) {
      setTargetEstimation(null);
      return;
    }
    setTargetEstimation(evaluateTargetSize(sizeEstimation, targetBytes));
  }, [targetSizeInput, sizeEstimation]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isOpen]);

  const handleCompressedDownload = useCallback(() => {
    if (!onCompressedDownload || !targetSizeInput.trim()) {
      onDownload();
      return;
    }
    const targetBytes = parseFileSize(targetSizeInput);
    if (targetBytes === null) {
      onDownload();
      return;
    }
    onCompressedDownload(targetBytes, compressionQuality / 100);
    setIsOpen(false);
  }, [onCompressedDownload, onDownload, targetSizeInput, compressionQuality]);

  const currentSize = sizeEstimation?.currentSizeBytes ?? 0;

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-stretch">
        <button
          onClick={onDownload}
          disabled={isSaving}
          title={saveMode === 'quick' ? 'Quick incremental save' : 'Optimized save'}
          className="flex items-center gap-2 text-xs font-medium pl-4 pr-3 py-2 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 disabled:from-zinc-700 disabled:to-zinc-800 disabled:text-zinc-500 text-white rounded-l-xl transition-all duration-200 ease-out shadow-lg shadow-blue-900/25 active:scale-[0.98]"
        >
          {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          Download
        </button>

        <button
          onClick={() => setIsOpen(!isOpen)}
          disabled={isSaving}
          title="Download options"
          className="flex items-center px-2 py-2 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 disabled:from-zinc-700 disabled:to-zinc-800 disabled:text-zinc-500 text-white rounded-r-xl border-l border-blue-400/30 transition-all duration-200 ease-out shadow-lg shadow-blue-900/25 active:scale-[0.98]"
        >
          <ChevronDown
            size={14}
            className={`transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`}
          />
        </button>
      </div>

      {isOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-[380px] bg-zinc-900/98 backdrop-blur-2xl border border-zinc-700/60 rounded-2xl shadow-2xl shadow-black/50 overflow-hidden z-50"
          style={{ animation: 'dropdownIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
          <div className="px-5 pt-4 pb-3 border-b border-zinc-800/60">
            <div className="flex items-center gap-2 mb-1">
              <HardDrive size={13} className="text-zinc-500" />
              <span className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">Current File</span>
            </div>
            <div className="text-lg font-semibold text-white tracking-tight">
              {currentSize > 0 ? formatFileSize(currentSize) : '—'}
            </div>
            {sizeEstimation && sizeEstimation.imageCount > 0 && (
              <p className="text-[10px] text-zinc-600 mt-1">
                {sizeEstimation.imageCount} image{sizeEstimation.imageCount > 1 ? 's' : ''} · {sizeEstimation.pageCount} page{sizeEstimation.pageCount > 1 ? 's' : ''}
              </p>
            )}
          </div>

          <div className="px-5 py-3 border-b border-zinc-800/60">
            <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider mb-2 block">
              Save Mode
            </label>
            <div className="flex gap-1.5 p-1 bg-zinc-800/50 rounded-xl">
              {[
                { value: 'optimized' as const, label: 'Optimized', desc: 'GC + dedup' },
                { value: 'quick' as const, label: 'Quick', desc: 'Incremental' },
              ].map(opt => (
                <button
                  key={opt.value}
                  onClick={() => onSaveModeChange(opt.value)}
                  className={`flex-1 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-200 ${
                    saveMode === opt.value
                      ? 'bg-zinc-700 text-white shadow-sm'
                      : 'text-zinc-500 hover:text-zinc-300'
                  }`}
                >
                  {opt.label}
                  <span className="block text-[9px] opacity-50 mt-0.5">{opt.desc}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="px-5 py-3 border-b border-zinc-800/60">
            <div className="flex items-center gap-2 mb-2">
              <Gauge size={13} className="text-zinc-500" />
              <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                Resolution
              </label>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {DPI_PRESETS.map(preset => (
                <button
                  key={preset.value}
                  onClick={() => setSelectedDpi(preset.value)}
                  className={`px-2 py-2 rounded-lg text-center transition-all duration-200 ${
                    selectedDpi === preset.value
                      ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30 ring-1 ring-blue-500/20'
                      : 'bg-zinc-800/40 text-zinc-500 border border-zinc-800 hover:bg-zinc-800/80 hover:text-zinc-300'
                  }`}
                >
                  <div className="text-xs font-medium">{preset.label}</div>
                  <div className="text-[9px] opacity-60 mt-0.5">{preset.value}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="px-5 py-3 border-b border-zinc-800/60">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Target size={13} className="text-zinc-500" />
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                  Compression
                </label>
              </div>
              <span className="text-xs font-mono text-zinc-300 bg-zinc-800 px-2 py-0.5 rounded-md">
                {compressionQuality}%
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              value={compressionQuality}
              onChange={(e) => setCompressionQuality(Number(e.target.value))}
              className="w-full accent-blue-500"
              style={{ height: '3px' }}
            />
            <div className="flex justify-between mt-1.5">
              <span className="text-[9px] text-zinc-600">Smallest file</span>
              <span className="text-[9px] text-zinc-600">Best quality</span>
            </div>
          </div>

          <div className="px-5 py-3 border-b border-zinc-800/60">
            <div className="flex items-center gap-2 mb-2">
              <HardDrive size={13} className="text-zinc-500" />
              <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                Target File Size
              </label>
              <span className="text-[9px] text-zinc-600 ml-auto">Optional</span>
            </div>
            <input
              type="text"
              value={targetSizeInput}
              onChange={(e) => setTargetSizeInput(e.target.value)}
              placeholder="e.g. 5 MB, 500 KB"
              className="w-full px-3 py-2.5 text-sm bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-zinc-200 placeholder:text-zinc-600 focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500/40 outline-none transition-all duration-200"
            />

            {targetEstimation && (
              <div className="mt-3 space-y-2">
                <div className="relative h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div className="absolute inset-0 flex">
                    <div className="flex-1 bg-gradient-to-r from-emerald-500/60 to-emerald-500/30 rounded-l-full" />
                    <div className="flex-1 bg-gradient-to-r from-amber-500/30 to-amber-500/60" />
                    <div className="flex-1 bg-gradient-to-r from-red-500/30 to-red-500/60 rounded-r-full" />
                  </div>
                  {(() => {
                    const targetBytes = parseFileSize(targetSizeInput);
                    if (!targetBytes || !sizeEstimation) return null;
                    const minB = sizeEstimation.minAchievableBytes;
                    const maxB = sizeEstimation.currentSizeBytes;
                    const range = maxB - minB;
                    let pct = range > 0 ? ((targetBytes - minB) / range) * 100 : 50;
                    pct = Math.max(2, Math.min(98, pct));
                    return (
                      <div
                        className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg border-2 border-zinc-900 transition-all duration-300"
                        style={{ left: `${pct}%`, marginLeft: '-6px' }}
                      />
                    );
                  })()}
                </div>

                <div className="flex justify-between text-[9px] text-zinc-600">
                  <span>{formatFileSize(sizeEstimation?.minAchievableBytes ?? 0)}</span>
                  <span>{formatFileSize(sizeEstimation?.currentSizeBytes ?? 0)}</span>
                </div>

                <div
                  className={`flex items-start gap-2 p-2.5 rounded-xl text-xs leading-relaxed ${
                    targetEstimation.zone === 'green'
                      ? 'bg-emerald-500/8 border border-emerald-500/15 text-emerald-400'
                      : targetEstimation.zone === 'yellow'
                        ? 'bg-amber-500/8 border border-amber-500/15 text-amber-400'
                        : 'bg-red-500/8 border border-red-500/15 text-red-400'
                  }`}
                >
                  {targetEstimation.zone === 'green' ? (
                    <CheckCircle2 size={14} className="flex-shrink-0 mt-0.5" />
                  ) : targetEstimation.zone === 'yellow' ? (
                    <Info size={14} className="flex-shrink-0 mt-0.5" />
                  ) : (
                    <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
                  )}
                  <span>{targetEstimation.message}</span>
                </div>
              </div>
            )}
          </div>

          <div className="px-5 py-3">
            <button
              onClick={() => {
                handleCompressedDownload();
                setIsOpen(false);
              }}
              disabled={isSaving || targetEstimation?.zone === 'red'}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 disabled:from-zinc-700 disabled:to-zinc-800 disabled:text-zinc-500 text-white font-medium text-sm rounded-xl shadow-lg shadow-blue-900/25 transition-all duration-200 ease-out active:scale-[0.98]"
            >
              {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {targetSizeInput.trim()
                ? `Download (Target: ${targetSizeInput})`
                : 'Download PDF'}
            </button>
          </div>
        </div>
      )}

      <style>{`
        @keyframes dropdownIn {
          from { opacity: 0; transform: translateY(-8px) scale(0.96); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
      `}</style>
    </div>
  );
}
