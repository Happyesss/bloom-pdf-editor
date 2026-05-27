'use client';

import { useEffect, useRef, useState } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { X, RotateCw, Trash2, Copy, GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PageManagerDialogProps {
  open: boolean;
  pdfBytes: ArrayBuffer | null;
  pageCount: number;
  onClose: () => void;
  onApply: (order: number[], deleted: Set<number>, rotations: Record<number, number>) => void;
}

interface PageItem {
  originalIndex: number;
  rotation: number;
}

function PageThumb({ pdfBytes, pageIndex, rotation }: { pdfBytes: ArrayBuffer; pageIndex: number; rotation: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
      if (cancelled) return;
      const page = await pdf.getPage(pageIndex + 1);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 0.25 });
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
    }
    render().catch(console.error);
    return () => { cancelled = true; };
  }, [pdfBytes, pageIndex]);

  return (
    <canvas
      ref={canvasRef}
      className="block bg-white"
      style={{ transform: `rotate(${rotation}deg)`, transition: 'transform 0.3s ease' }}
    />
  );
}

export default function PageManagerDialog({
  open,
  pdfBytes,
  pageCount,
  onClose,
  onApply,
}: PageManagerDialogProps) {
  const [pages, setPages] = useState<PageItem[]>([]);
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const dragIndexRef = useRef<number | null>(null);

  useEffect(() => {
    if (open) {
      setPages(Array.from({ length: pageCount }, (_, i) => ({ originalIndex: i, rotation: 0 })));
      setDeleted(new Set());
    }
  }, [open, pageCount]);

  if (!open || !pdfBytes) return null;

  const rotate = (idx: number) => {
    setPages((prev) => prev.map((p, i) => i === idx ? { ...p, rotation: (p.rotation + 90) % 360 } : p));
  };

  const duplicate = (idx: number) => {
    setPages((prev) => {
      const next = [...prev];
      next.splice(idx + 1, 0, { ...prev[idx] });
      return next;
    });
  };

  const deletePage = (idx: number) => {
    setPages((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleDragStart = (idx: number) => {
    dragIndexRef.current = idx;
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    const from = dragIndexRef.current;
    if (from === null || from === idx) return;
    setPages((prev) => {
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(idx, 0, item);
      dragIndexRef.current = idx;
      return next;
    });
  };

  const handleApply = () => {
    const rotationMap: Record<number, number> = {};
    pages.forEach((p) => {
      if (p.rotation !== 0) rotationMap[p.originalIndex] = p.rotation;
    });
    onApply(
      pages.map((p) => p.originalIndex),
      deleted,
      rotationMap
    );
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-700 rounded-2xl w-full max-w-3xl max-h-[85vh] flex flex-col shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-zinc-700">
          <h2 className="text-lg font-semibold text-white">Page Manager</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white"><X size={20} /></button>
        </div>

        <p className="text-xs text-zinc-500 px-4 pt-2">
          Drag to reorder · Rotate, duplicate or delete individual pages
        </p>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="grid grid-cols-4 gap-3">
            {pages.map((page, idx) => (
              <div
                key={`${page.originalIndex}-${idx}`}
                draggable
                onDragStart={() => handleDragStart(idx)}
                onDragOver={(e) => handleDragOver(e, idx)}
                className="flex flex-col items-center gap-2 p-2 rounded-xl border border-zinc-700 hover:border-zinc-500 bg-zinc-800 cursor-grab active:cursor-grabbing group transition-colors"
              >
                <div className="flex items-center justify-between w-full">
                  <GripVertical size={14} className="text-zinc-600" />
                  <span className="text-xs text-zinc-400">P.{idx + 1}</span>
                  <span className="text-xs text-zinc-600">(orig. {page.originalIndex + 1})</span>
                </div>

                <div className="overflow-hidden rounded bg-white shadow w-full flex items-center justify-center min-h-[80px]">
                  <PageThumb pdfBytes={pdfBytes} pageIndex={page.originalIndex} rotation={page.rotation} />
                </div>

                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => rotate(idx)} title="Rotate 90°" className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white">
                    <RotateCw size={13} />
                  </button>
                  <button onClick={() => duplicate(idx)} title="Duplicate" className="p-1 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white">
                    <Copy size={13} />
                  </button>
                  <button onClick={() => deletePage(idx)} title="Delete" className="p-1 rounded hover:bg-red-900/60 text-zinc-400 hover:text-red-400">
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-3 p-4 border-t border-zinc-700">
          <button onClick={onClose} className="px-4 py-2 rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-sm transition-colors">
            Cancel
          </button>
          <button onClick={handleApply} className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors">
            Apply Changes
          </button>
        </div>
      </div>
    </div>
  );
}
