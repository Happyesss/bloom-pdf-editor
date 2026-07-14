'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
  Download,
  ChevronDown,
  Loader2,
  Gauge,
  Target,
  HardDrive,
  Info,
} from 'lucide-react';
import type { PDFDocumentData } from '@/engine';
import {
  estimateDocumentSize,
  formatFileSize,
  type SizeEstimation,
} from '../export-formats';

// ─── Props ──────────────────────────────────────────────────────────────────────

export interface CompressedDownloadOptions {
  /** JPEG quality 0–1. Used when targetBytes is not set. */
  quality: number;
  /** Target image DPI (downsamples denser images). */
  dpi: number;
  /** Optional max file size in bytes — binary-searches quality to fit. */
  targetBytes?: number;
}

interface DownloadDropdownProps {
  isSaving: boolean;
  onDownload: () => void;
  saveMode: 'quick' | 'optimized';
  onSaveModeChange: (mode: 'quick' | 'optimized') => void;
  doc: PDFDocumentData | null;
  /** Custom download with compression / DPI / target size. */
  onCompressedDownload?: (opts: CompressedDownloadOptions) => void;
}

// ─── DPI Presets ────────────────────────────────────────────────────────────────

const DPI_PRESETS = [
  { value: 72, label: 'Screen', desc: '72 DPI — Smallest file' },
  { value: 150, label: 'Standard', desc: '150 DPI — Good balance' },
  { value: 300, label: 'Print', desc: '300 DPI — Print quality' },
  { value: 600, label: 'High', desc: '600 DPI — Maximum detail' },
];

const COMPRESSION_PRESETS = [
  { value: 20, label: 'Extreme', desc: 'Smallest file' },
  { value: 50, label: 'High', desc: 'Good balance' },
  { value: 75, label: 'Medium', desc: 'Better quality' },
  { value: 100, label: 'Low', desc: 'Highest quality' },
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
  const [compressionQuality, setCompressionQuality] = useState(75);
  const [sizeEstimation, setSizeEstimation] = useState<SizeEstimation | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && doc) {
      setSizeEstimation(estimateDocumentSize(doc));
    }
  }, [isOpen, doc]);

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

  const handleOptionsDownload = useCallback(() => {
    if (!onCompressedDownload) {
      onDownload();
      setIsOpen(false);
      return;
    }
    // Dropdown Download always runs the compressor with current settings
    onCompressedDownload({
      quality: compressionQuality / 100,
      dpi: selectedDpi,
    });
    setIsOpen(false);
  }, [
    onCompressedDownload,
    onDownload,
    compressionQuality,
    selectedDpi,
  ]);

  const currentSize = sizeEstimation?.currentSizeBytes ?? 0;

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-stretch">
        <button
          onClick={onDownload}
          disabled={isSaving}
          title="Download original / edited PDF (no recompression)"
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
            <div className="flex items-center gap-1.5 mb-2">
              <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider block">
                Save Mode
              </label>
              <div className="group relative flex items-center justify-center">
                <Info size={12} className="text-zinc-500 hover:text-zinc-300 cursor-help transition-colors" />
                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-56 p-2.5 bg-zinc-800 border border-zinc-700/60 rounded-xl shadow-xl text-[10.5px] text-zinc-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-[60] leading-relaxed">
                  <strong className="text-zinc-100">Save Mode</strong> determines how changes are saved.
                  <ul className="mt-1.5 space-y-1 list-disc pl-3.5 text-zinc-400">
                    <li><strong className="text-zinc-200">Optimized:</strong> Rebuilds the file and removes unused data. Slower, but results in a smaller file.</li>
                    <li><strong className="text-zinc-200">Quick:</strong> Appends changes to the end. Faster, but file size grows over time.</li>
                  </ul>
                  <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 border-[6px] border-transparent border-t-zinc-700/60" />
                  <div className="absolute -bottom-[5px] left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-zinc-800" />
                </div>
              </div>
            </div>
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
              <div className="flex items-center gap-1.5">
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                  Resolution
                </label>
                <div className="group relative flex items-center justify-center">
                  <Info size={12} className="text-zinc-500 hover:text-zinc-300 cursor-help transition-colors" />
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-56 p-2.5 bg-zinc-800 border border-zinc-700/60 rounded-xl shadow-xl text-[10.5px] text-zinc-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-[60] leading-relaxed">
                    <strong className="text-zinc-100">DPI (Dots Per Inch)</strong> controls image clarity. Higher DPI looks better but makes the file bigger.
                    <ul className="mt-1.5 space-y-1 list-disc pl-3.5 text-zinc-400">
                      <li><strong className="text-zinc-200">72:</strong> Good for sharing on web/email.</li>
                      <li><strong className="text-zinc-200">150:</strong> Good balance for viewing on screens.</li>
                      <li><strong className="text-zinc-200">300:</strong> Standard for high-quality printing.</li>
                      <li><strong className="text-zinc-200">600:</strong> Maximum detail (very large file).</li>
                    </ul>
                    <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 border-[6px] border-transparent border-t-zinc-700/60" />
                    <div className="absolute -bottom-[5px] left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-zinc-800" />
                  </div>
                </div>
              </div>
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
            <p className="text-[9px] text-zinc-600 mt-2">
              Downsamples embedded images denser than the selected DPI.
            </p>
          </div>

          <div className="px-5 py-3 border-b border-zinc-800/60">
            <div className="flex items-center gap-2 mb-2">
              <Target size={13} className="text-zinc-500" />
              <div className="flex items-center gap-1.5">
                <label className="text-[11px] font-medium text-zinc-400 uppercase tracking-wider">
                  Compression
                </label>
                <div className="group relative flex items-center justify-center">
                  <Info size={12} className="text-zinc-500 hover:text-zinc-300 cursor-help transition-colors" />
                  <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 w-56 p-2.5 bg-zinc-800 border border-zinc-700/60 rounded-xl shadow-xl text-[10.5px] text-zinc-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-[60] leading-relaxed">
                    <strong className="text-zinc-100">Compression</strong> shrinks the file size.
                    <p className="mt-1.5 text-zinc-400">Lower quality makes images smaller but slightly blurrier. We also remove unused fonts to save space.</p>
                    <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 border-[6px] border-transparent border-t-zinc-700/60" />
                    <div className="absolute -bottom-[5px] left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-zinc-800" />
                  </div>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-4 gap-1.5">
              {COMPRESSION_PRESETS.map(preset => (
                <button
                  key={preset.value}
                  onClick={() => setCompressionQuality(preset.value)}
                  className={`px-2 py-2 rounded-lg text-center transition-all duration-200 ${
                    compressionQuality === preset.value
                      ? 'bg-blue-500/15 text-blue-400 border border-blue-500/30 ring-1 ring-blue-500/20'
                      : 'bg-zinc-800/40 text-zinc-500 border border-zinc-800 hover:bg-zinc-800/80 hover:text-zinc-300'
                  }`}
                >
                  <div className="text-xs font-medium">{preset.label}</div>
                  <div className="text-[9px] opacity-60 mt-0.5">{preset.desc}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="px-5 py-3">
            <p className="text-[10px] text-zinc-500 mb-2 leading-relaxed">
              Use this button to apply compression. The left “Download” saves without recompressing.
              Small text PDFs barely shrink; large image/scan PDFs shrink the most.
            </p>
            <button
              onClick={handleOptionsDownload}
              disabled={isSaving}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gradient-to-b from-blue-500 to-blue-600 hover:from-blue-400 hover:to-blue-500 disabled:from-zinc-700 disabled:to-zinc-800 disabled:text-zinc-500 text-white font-medium text-sm rounded-xl shadow-lg shadow-blue-900/25 transition-all duration-200 ease-out active:scale-[0.98]"
            >
              {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {`Download (${compressionQuality}% · ${selectedDpi} DPI)`}
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
