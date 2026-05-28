'use client';

import { useEffect, useRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEditorStore } from '@/store/editorStore';

interface ThumbnailProps {
  pdfBytes: ArrayBuffer;
  pageIndex: number;
  isActive: boolean;
  pageNumber: number;
  canDelete: boolean;
  onClick: () => void;
  onDelete: () => void;
}

function PageThumbnail({ pdfBytes, pageIndex, isActive, pageNumber, canDelete, onClick, onDelete }: ThumbnailProps) {
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
    <div
      className={cn(
        'group relative flex flex-col items-center gap-1.5 p-2 rounded-lg transition-all w-full',
        isActive ? 'bg-blue-500/20 ring-2 ring-blue-500' : 'hover:bg-zinc-700/50'
      )}
    >
      <button
        onClick={onClick}
        className="flex flex-col items-center gap-1.5 cursor-pointer w-full"
      >
        <div className="bg-white rounded overflow-hidden shadow">
          <canvas ref={canvasRef} className="block" />
        </div>
        <span className="text-xs text-zinc-400">{pageNumber}</span>
      </button>

      {canDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (confirm(`Delete page ${pageNumber}? This cannot be undone.`)) onDelete();
          }}
          title={`Delete page ${pageNumber}`}
          aria-label={`Delete page ${pageNumber}`}
          className="absolute top-1.5 right-1.5 w-6 h-6 rounded-md bg-red-500/90 hover:bg-red-500 text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center shadow-lg"
        >
          <Trash2 size={12} />
        </button>
      )}
    </div>
  );
}

interface SidebarProps {
  pdfBytes: ArrayBuffer;
  pageCount: number;
  currentPage: number;
  onPageSelect: (page: number) => void;
}

export default function Sidebar({ pdfBytes, pageCount, currentPage, onPageSelect }: SidebarProps) {
  const deletePage = useEditorStore((s) => s.deletePage);

  return (
    <div className="w-36 flex-shrink-0 bg-zinc-900 border-r border-zinc-700 overflow-y-auto flex flex-col gap-1 p-2">
      <p className="text-xs text-zinc-500 font-medium px-1 py-1 sticky top-0 bg-zinc-900 z-10">
        PAGES ({pageCount})
      </p>
      {Array.from({ length: pageCount }, (_, i) => (
        <PageThumbnail
          key={`${pageCount}-${i}`}
          pdfBytes={pdfBytes}
          pageIndex={i}
          pageNumber={i + 1}
          isActive={currentPage === i + 1}
          canDelete={pageCount > 1}
          onClick={() => onPageSelect(i + 1)}
          onDelete={() => deletePage(i)}
        />
      ))}
    </div>
  );
}
