import React from 'react';
import { Layers, Loader2 } from 'lucide-react';

interface ThumbnailsSidebarProps {
  totalPages: number;
  currentPage: number;
  thumbnails: string[];
  isGeneratingThumbnails: boolean;
  onPageSelect: (index: number) => void;
}

export function ThumbnailsSidebar({
  totalPages,
  currentPage,
  thumbnails,
  isGeneratingThumbnails,
  onPageSelect
}: ThumbnailsSidebarProps) {
  return (
    <div className="w-56 bg-zinc-900/95 backdrop-blur-md border-l border-zinc-800/80 flex flex-col shrink-0 z-10 overflow-y-auto p-3 gap-3 shadow-[-4px_0_24px_rgba(0,0,0,0.2)]">
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-400 uppercase px-1 pt-1 pb-1 sticky top-0 bg-zinc-900/95 backdrop-blur-sm z-10">
          <Layers size={12} />
          Pages
          <span className="ml-auto text-zinc-600">{totalPages}</span>
        </div>
        {isGeneratingThumbnails && thumbnails.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-zinc-500">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-[10px] font-medium">Generating...</span>
          </div>
        ) : (
          thumbnails.map((thumbDataUrl, i) => (
            <div
              key={i}
              className={`group relative flex flex-col items-center cursor-pointer p-1.5 rounded-lg border-2 transition-all duration-300 ${
                currentPage === i
                  ? 'border-blue-500 bg-blue-500/5 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                  : 'border-transparent hover:bg-zinc-800/80'
              }`}
              onClick={() => onPageSelect(i)}
            >
              <span className={`text-[9px] font-bold mb-1 transition-colors ${currentPage === i ? 'text-blue-400' : 'text-zinc-600 group-hover:text-zinc-400'}`}>
                {i + 1}
              </span>
              <div className="w-full relative shadow-sm bg-white rounded overflow-hidden transition-transform duration-300 group-hover:scale-[1.02]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbDataUrl} alt={`Page ${i + 1}`} className="w-full pointer-events-none" />
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
