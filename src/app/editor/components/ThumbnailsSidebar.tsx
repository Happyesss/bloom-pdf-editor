import React, { useRef, useState } from 'react';
import { Layers, Loader2, Trash2, FilePlus, FileText, Plus } from 'lucide-react';

interface ThumbnailsSidebarProps {
  totalPages: number;
  currentPage: number;
  thumbnails: string[];
  isGeneratingThumbnails: boolean;
  onPageSelect: (index: number) => void;
  onDeletePage?: (index: number) => void;
  onInsertBlankPage?: (index: number) => void;
  onInsertPdf?: (index: number, file: File) => void;
}

export function ThumbnailsSidebar({
  totalPages,
  currentPage,
  thumbnails,
  isGeneratingThumbnails,
  onPageSelect,
  onDeletePage,
  onInsertBlankPage,
  onInsertPdf
}: ThumbnailsSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [insertTarget, setInsertTarget] = useState<number | null>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && insertTarget !== null) {
      onInsertPdf?.(insertTarget, e.target.files[0]);
    }
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
    setInsertTarget(null);
  };

  const InsertActions = ({ index }: { index: number }) => (
    <div className="flex gap-1 justify-center mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
      <button
        title="Insert Blank Page"
        className="p-1 rounded bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onInsertBlankPage?.(index);
        }}
      >
        <FilePlus size={12} />
      </button>
      <button
        title="Insert PDF"
        className="p-1 rounded bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          setInsertTarget(index);
          fileInputRef.current?.click();
        }}
      >
        <FileText size={12} />
      </button>
    </div>
  );

  return (
    <div className="w-56 bg-zinc-900/95 backdrop-blur-md border-l border-zinc-800/80 flex flex-col shrink-0 z-10 overflow-y-auto p-3 gap-3 shadow-[-4px_0_24px_rgba(0,0,0,0.2)] relative">
      <input 
        type="file" 
        accept="application/pdf"
        className="hidden" 
        ref={fileInputRef}
        onChange={handleFileChange}
      />
      <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-3">
        <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-400 uppercase px-1 pt-1 pb-1 sticky top-0 bg-zinc-900/95 backdrop-blur-sm z-10">
          <Layers size={12} />
          Pages
          <span className="ml-auto text-zinc-600">{totalPages}</span>
        </div>
        
        {/* Insert at the very beginning (index 0) */}
        {!isGeneratingThumbnails && thumbnails.length > 0 && (
          <div className="group relative flex justify-center py-1 -mb-2 z-20">
            <div className="h-0.5 w-full bg-blue-500/50 transition-colors rounded"></div>
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-900 border border-zinc-700 rounded-md p-0.5 shadow-lg flex gap-1 opacity-100 scale-100 transition-all">
              <button title="Insert Blank Page" className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors" onClick={() => onInsertBlankPage?.(0)}><FilePlus size={14} /></button>
              <button title="Insert PDF" className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors" onClick={() => { setInsertTarget(0); fileInputRef.current?.click(); }}><FileText size={14} /></button>
            </div>
          </div>
        )}

        {isGeneratingThumbnails && thumbnails.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3 text-zinc-500">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-[10px] font-medium">Generating...</span>
          </div>
        ) : (
          thumbnails.map((thumbDataUrl, i) => (
            <React.Fragment key={i}>
              <div
                className={`group relative flex flex-col items-center cursor-pointer p-1.5 rounded-lg border-2 transition-all duration-300 ${
                  currentPage === i
                    ? 'border-blue-500 bg-blue-500/5 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                    : 'border-transparent hover:bg-zinc-800/80'
                }`}
                onClick={() => onPageSelect(i)}
              >
                {totalPages > 1 && (
                  <button
                    title="Delete Page"
                    className="absolute top-2 right-2 bg-red-500/90 text-white p-1 rounded-md opacity-0 group-hover:opacity-100 transition-all shadow-md hover:bg-red-500 hover:scale-110 z-20"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (window.confirm("Do you really want to delete this page?")) {
                        onDeletePage?.(i);
                      }
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                )}
                
                <span className={`text-[9px] font-bold mb-1 transition-colors ${currentPage === i ? 'text-blue-400' : 'text-zinc-600 group-hover:text-zinc-400'}`}>
                  {i + 1}
                </span>
                <div className="w-full relative shadow-sm bg-white rounded overflow-hidden transition-transform duration-300 group-hover:scale-[1.02]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumbDataUrl} alt={`Page ${i + 1}`} className="w-full pointer-events-none" />
                </div>
              </div>
              
              {/* Insert divider after page i */}
              <div className="group relative flex justify-center py-1 -mt-1 -mb-2 z-20">
                <div className="h-0.5 w-full bg-blue-500/50 transition-colors rounded"></div>
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-900 border border-zinc-700 rounded-md p-0.5 shadow-lg flex gap-1 opacity-100 scale-100 transition-all">
                  <button title="Insert Blank Page" className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors" onClick={() => onInsertBlankPage?.(i + 1)}><FilePlus size={14} /></button>
                  <button title="Insert PDF" className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors" onClick={() => { setInsertTarget(i + 1); fileInputRef.current?.click(); }}><FileText size={14} /></button>
                </div>
              </div>
            </React.Fragment>
          ))
        )}
      </div>
    </div>
  );
}
