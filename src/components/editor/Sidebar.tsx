'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { cn } from '@/lib/utils';

interface ThumbnailProps {
  pdfBytes: ArrayBuffer;
  pageIndex: number;
  isActive: boolean;
  pageNumber: number;
  onClick: () => void;
}

function PageThumbnail({ pdfBytes, pageIndex, isActive, pageNumber, onClick }: ThumbnailProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    async function render() {
      pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const pdf = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
      if (cancelled) return;
      const page = await pdf.getPage(pageIndex + 1);
      if (cancelled) return;
      const viewport = page.getViewport({ scale: 0.2 });
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
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-1.5 p-2 rounded-lg transition-all cursor-pointer w-full',
        isActive ? 'bg-blue-500/20 ring-2 ring-blue-500' : 'hover:bg-zinc-700/50'
      )}
    >
      <div className="bg-white rounded overflow-hidden shadow">
        <canvas ref={canvasRef} className="block" />
      </div>
      <span className="text-xs text-zinc-400">{pageNumber}</span>
    </button>
  );
}

interface SidebarProps {
  pdfBytes: ArrayBuffer;
  pageCount: number;
  currentPage: number;
  onPageSelect: (page: number) => void;
}

export default function Sidebar({ pdfBytes, pageCount, currentPage, onPageSelect }: SidebarProps) {
  return (
    <div className="w-36 flex-shrink-0 bg-zinc-900 border-r border-zinc-700 overflow-y-auto flex flex-col gap-1 p-2">
      <p className="text-xs text-zinc-500 font-medium px-1 py-1 sticky top-0 bg-zinc-900 z-10">
        PAGES ({pageCount})
      </p>
      {Array.from({ length: pageCount }, (_, i) => (
        <PageThumbnail
          key={i}
          pdfBytes={pdfBytes}
          pageIndex={i}
          pageNumber={i + 1}
          isActive={currentPage === i + 1}
          onClick={() => onPageSelect(i + 1)}
        />
      ))}
    </div>
  );
}
