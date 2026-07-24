'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Layers,
  Loader2,
  Trash2,
  FilePlus,
  FileText,
  RotateCw,
  GripVertical,
  Info,
  Scissors,
  Combine,
  Maximize2,
  Minimize2,
} from 'lucide-react';
import * as Tooltip from '@radix-ui/react-tooltip';

interface ThumbnailsSidebarProps {
  totalPages: number;
  currentPage: number;
  thumbnails: string[];
  isGeneratingThumbnails: boolean;
  onPageSelect: (index: number) => void;
  onDeletePage?: (index: number) => void;
  onInsertBlankPage?: (index: number) => void;
  onInsertPdf?: (index: number, file: File) => void;
  onRotatePage?: (index: number) => void;
  onReorderPages?: (fromIndex: number, toIndex: number) => void;
  onMergePdf?: (file: File) => void;
  onSplitCurrentPage?: () => void;
  onSplitAllPages?: () => void;
  onRemoveCurrentPage?: () => void;
}

function IconTip({
  label,
  side = 'top',
  children,
}: {
  label: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactElement;
}) {
  return (
    <Tooltip.Root delayDuration={250}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side={side}
          sideOffset={6}
          className="z-[200] max-w-[200px] rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[10px] font-medium leading-snug text-zinc-200 shadow-xl animate-in fade-in zoom-in-95"
        >
          {label}
          <Tooltip.Arrow className="fill-zinc-900" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

const PAGE_CAPABILITIES = [
  { id: 'split', icon: Scissors, label: 'Split pages', color: 'text-blue-400', steps: 'Remove unwanted pages using the trash icon, then click Download to save the new PDF.' },
  { id: 'merge', icon: Combine, label: 'Merge PDFs', color: 'text-blue-400', steps: 'Hover between pages and click the "Insert from PDF" icon to append another file, then Download.' },
  { id: 'blank', icon: FilePlus, label: 'Add blank page', color: 'text-zinc-400', steps: 'Hover between pages and click the "Add blank page" icon to insert an empty page.' },
  { id: 'insert', icon: FileText, label: 'Insert from PDF', color: 'text-zinc-400', steps: 'Hover between pages and click the "Insert from PDF" icon to append pages.' },
  { id: 'reorder', icon: GripVertical, label: 'Re-order pages', color: 'text-zinc-400', steps: 'Click and drag any page thumbnail to move it to a new position in the document.' },
  { id: 'rotate', icon: RotateCw, label: 'Rotate page', color: 'text-zinc-400', steps: 'Hover over a page thumbnail and click the rotate icon to turn it 90 degrees.' },
  { id: 'delete', icon: Trash2, label: 'Delete page', color: 'text-red-400', steps: 'Hover over a page thumbnail and click the red trash icon to remove it.' },
];

export function ThumbnailsSidebar({
  totalPages,
  currentPage,
  thumbnails,
  isGeneratingThumbnails,
  onPageSelect,
  onDeletePage,
  onInsertBlankPage,
  onInsertPdf,
  onRotatePage,
  onReorderPages,
  onMergePdf,
  onSplitCurrentPage,
  onSplitAllPages,
  onRemoveCurrentPage,
}: ThumbnailsSidebarProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const [insertTarget, setInsertTarget] = useState<number | null>(null);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dropTarget, setDropTarget] = useState<number | null>(null);
  const dragIndexRef = useRef<number | null>(null);
  const [hoveredGuide, setHoveredGuide] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    dragIndexRef.current = dragIndex;
  }, [dragIndex]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0 && insertTarget !== null) {
      onInsertPdf?.(insertTarget, e.target.files[0]);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
    setInsertTarget(null);
  };

  const handleMergeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onMergePdf?.(e.target.files[0]);
    }
    if (mergeInputRef.current) mergeInputRef.current.value = '';
  };

  const openInsertPdf = (index: number) => {
    setInsertTarget(index);
    fileInputRef.current?.click();
  };

  const clearDrag = () => {
    setDragIndex(null);
    setDropTarget(null);
  };

  const commitDrop = (toIndex: number) => {
    const from = dragIndexRef.current;
    clearDrag();
    if (from == null || from === toIndex) return;
    onReorderPages?.(from, toIndex);
  };

  const InsertBar = ({
    insertAt,
    rotatePageIndex,
  }: {
    insertAt: number;
    rotatePageIndex: number;
  }) => (
    <div
      className={`group/bar relative flex justify-center z-20 ${isExpanded ? 'flex-col px-1 h-auto self-stretch' : 'py-1 w-full'}`}
      onDragOver={(e) => {
        if (dragIndexRef.current == null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        // Dropping on the gap before `insertAt` places the page at insertAt
        // (adjusted after removal of the dragged page).
        setDropTarget(insertAt > (dragIndexRef.current ?? -1) ? insertAt - 1 : insertAt);
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const from = dragIndexRef.current;
        if (from == null) return;
        const to = insertAt > from ? insertAt - 1 : insertAt;
        clearDrag();
        if (from !== to) onReorderPages?.(from, to);
      }}
    >
      <div
        className={`rounded transition-colors ${
          dragIndex != null && dropTarget === (insertAt > dragIndex ? insertAt - 1 : insertAt)
            ? (isExpanded ? 'bg-blue-400 w-1 h-full' : 'bg-blue-400 h-1 w-full')
            : (isExpanded ? 'bg-blue-500/50 w-0.5 h-full' : 'bg-blue-500/50 h-0.5 w-full')
        }`}
      />
      <div className={`absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-zinc-900 border border-zinc-700 rounded-md p-0.5 shadow-lg flex ${isExpanded ? 'flex-col gap-0.5' : 'gap-0.5'}`}>
        <IconTip label="Insert blank page here">
          <button
            type="button"
            aria-label="Insert blank page"
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
            onClick={() => onInsertBlankPage?.(insertAt)}
          >
            <FilePlus size={14} />
          </button>
        </IconTip>
        <IconTip label="Rotate page 90° clockwise">
          <button
            type="button"
            aria-label="Rotate page"
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
            onClick={() => onRotatePage?.(rotatePageIndex)}
          >
            <RotateCw size={14} />
          </button>
        </IconTip>
        <IconTip label="Insert pages from another PDF">
          <button
            type="button"
            aria-label="Insert PDF"
            className="p-1 rounded text-zinc-400 hover:text-white hover:bg-zinc-700 transition-colors"
            onClick={() => openInsertPdf(insertAt)}
          >
            <FileText size={14} />
          </button>
        </IconTip>
      </div>
    </div>
  );

  return (
    <Tooltip.Provider delayDuration={250} skipDelayDuration={100}>
      <div className={`transition-all duration-300 bg-panel/95 backdrop-blur-md border-l border-app flex flex-col shrink-0 overflow-y-auto p-3 gap-3 shadow-[0_0_40px_rgba(0,0,0,0.12)] ${isExpanded ? 'absolute right-0 top-0 bottom-0 w-[80vw] z-30' : 'relative w-56 z-10'}`}>
        <input
          type="file"
          accept="application/pdf"
          className="hidden"
          ref={fileInputRef}
          onChange={handleFileChange}
        />
        <input
          type="file"
          accept="application/pdf"
          className="hidden"
          ref={mergeInputRef}
          onChange={handleMergeChange}
        />

        <div className={`flex-1 overflow-y-auto p-3 flex ${isExpanded ? 'flex-row flex-wrap gap-x-2 gap-y-6 items-stretch content-start' : 'flex-col gap-3'}`}>
          <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-app-muted uppercase px-1 pt-1 pb-1 sticky top-0 bg-panel/95 backdrop-blur-sm z-30 w-full">
            <Layers size={12} />
            Pages
            <Tooltip.Root delayDuration={250}>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  aria-label="Page capabilities information"
                  className="ml-0.5 p-1 rounded text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors cursor-help"
                >
                  <Info size={12} />
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  side="bottom"
                  sideOffset={6}
                  className="z-[200] w-48 rounded-md border border-zinc-700 bg-zinc-900 p-2 text-[10px] font-medium leading-snug text-zinc-300 shadow-xl flex flex-col gap-1.5 relative"
                >
                  <div className="font-bold text-zinc-400 pb-1 border-b border-zinc-800 mb-1 uppercase tracking-wider text-[9px]">Page capabilities</div>
                  {PAGE_CAPABILITIES.map(cap => (
                    <div 
                      key={cap.id}
                      className="flex items-center gap-2 cursor-help p-1 -mx-1 rounded hover:bg-zinc-800/50 transition-colors"
                      onMouseEnter={() => setHoveredGuide(cap.id)}
                      onMouseLeave={() => setHoveredGuide(null)}
                    >
                      <cap.icon size={12} className={`${cap.color} shrink-0`} />
                      <span>{cap.label}</span>
                    </div>
                  ))}

                  {hoveredGuide && (
                    <div className="absolute right-full top-0 mr-2 w-48 bg-zinc-800 border border-zinc-700 rounded-lg p-3 shadow-2xl animate-in fade-in slide-in-from-right-2 pointer-events-none">
                      <div className="font-bold text-white text-xs mb-1.5">
                        {PAGE_CAPABILITIES.find(c => c.id === hoveredGuide)?.label}
                      </div>
                      <div className="text-[10px] text-zinc-400 leading-relaxed font-normal">
                        {PAGE_CAPABILITIES.find(c => c.id === hoveredGuide)?.steps}
                      </div>
                    </div>
                  )}
                  <Tooltip.Arrow className="fill-zinc-900" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
            <span className="ml-auto text-zinc-600">{totalPages}</span>
            <Tooltip.Root delayDuration={250}>
              <Tooltip.Trigger asChild>
                <button
                  type="button"
                  aria-label={isExpanded ? "Collapse sidebar" : "Expand sidebar"}
                  className="ml-1 p-1 rounded text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
                  onClick={() => setIsExpanded(!isExpanded)}
                >
                  {isExpanded ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                </button>
              </Tooltip.Trigger>
              <Tooltip.Portal>
                <Tooltip.Content
                  side="bottom"
                  sideOffset={6}
                  className="z-[200] rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-[10px] font-medium text-zinc-200 shadow-xl"
                >
                  {isExpanded ? "Collapse" : "Expand to Grid"}
                  <Tooltip.Arrow className="fill-zinc-900" />
                </Tooltip.Content>
              </Tooltip.Portal>
            </Tooltip.Root>
          </div>

          {!isGeneratingThumbnails && thumbnails.length > 0 && (
            <InsertBar insertAt={0} rotatePageIndex={0} />
          )}

          {isGeneratingThumbnails && thumbnails.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-8 gap-3 text-zinc-500">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-[10px] font-medium">Generating...</span>
            </div>
          ) : (
            thumbnails.map((thumbDataUrl, i) => {
              const isDragging = dragIndex === i;
              const isDropTarget = dropTarget === i && dragIndex !== i;

              return (
                <React.Fragment key={i}>
                  <div
                    draggable={!!onReorderPages && totalPages > 1}
                    className={`group relative flex flex-col items-center cursor-pointer p-1.5 rounded-lg border-2 transition-all duration-200 ${
                      isExpanded ? 'w-32 sm:w-40 md:w-48' : 'w-full'
                    } ${
                      currentPage === i
                        ? 'border-blue-500 bg-blue-500/5 shadow-[0_0_12px_rgba(59,130,246,0.15)]'
                        : isDropTarget
                          ? 'border-blue-400/80 bg-blue-500/10'
                          : 'border-transparent hover:bg-zinc-800/80'
                    } ${isDragging ? 'opacity-40 scale-[0.98]' : ''} ${
                      onReorderPages && totalPages > 1 ? 'cursor-grab active:cursor-grabbing' : ''
                    }`}
                    onClick={() => {
                      if (dragIndex != null) return;
                      onPageSelect(i);
                    }}
                    onDragStart={(e) => {
                      if (!onReorderPages || totalPages <= 1) {
                        e.preventDefault();
                        return;
                      }
                      e.dataTransfer.effectAllowed = 'move';
                      e.dataTransfer.setData('text/plain', String(i));
                      // Avoid native ghost looking broken for some browsers
                      try {
                        const img = e.currentTarget.querySelector('img');
                        if (img) e.dataTransfer.setDragImage(img, 40, 50);
                      } catch {
                        /* ignore */
                      }
                      setDragIndex(i);
                      setDropTarget(i);
                    }}
                    onDragOver={(e) => {
                      if (dragIndexRef.current == null) return;
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                      if (dropTarget !== i) setDropTarget(i);
                    }}
                    onDragEnter={(e) => {
                      if (dragIndexRef.current == null) return;
                      e.preventDefault();
                      setDropTarget(i);
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      commitDrop(i);
                    }}
                    onDragEnd={clearDrag}
                  >
                    {onReorderPages && totalPages > 1 && (
                      <IconTip label="Drag to reorder pages" side="left">
                        <span
                          className="absolute top-2 left-2 text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
                          aria-hidden
                        >
                          <GripVertical size={12} />
                        </span>
                      </IconTip>
                    )}

                    {totalPages > 1 && (
                      <IconTip label="Delete this page" side="left">
                        <button
                          type="button"
                          aria-label="Delete page"
                          className="absolute top-2 right-2 bg-red-500/90 text-white p-1 rounded-md opacity-0 group-hover:opacity-100 transition-all shadow-md hover:bg-red-500 hover:scale-110 z-20"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm('Do you really want to delete this page?')) {
                              onDeletePage?.(i);
                            }
                          }}
                        >
                          <Trash2 size={12} />
                        </button>
                      </IconTip>
                    )}

                    <div className="flex items-center gap-1 mb-1">
                      <span
                        className={`text-[9px] font-bold transition-colors ${
                          currentPage === i
                            ? 'text-blue-400'
                            : 'text-zinc-600 group-hover:text-zinc-400'
                        }`}
                      >
                        {i + 1}
                      </span>
                      <IconTip label="Rotate this page 90° clockwise">
                        <button
                          type="button"
                          aria-label={`Rotate page ${i + 1}`}
                          className="p-0.5 rounded text-zinc-600 opacity-0 group-hover:opacity-100 hover:text-white hover:bg-zinc-700 transition-all"
                          onClick={(e) => {
                            e.stopPropagation();
                            onRotatePage?.(i);
                          }}
                        >
                          <RotateCw size={10} />
                        </button>
                      </IconTip>
                    </div>

                    <div className="w-full relative shadow-sm bg-white rounded overflow-hidden transition-transform duration-300 group-hover:scale-[1.02] pointer-events-none">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={thumbDataUrl} alt={`Page ${i + 1}`} className="w-full" draggable={false} />
                    </div>
                  </div>

                  <InsertBar insertAt={i + 1} rotatePageIndex={i} />
                </React.Fragment>
              );
            })
          )}
        </div>
      </div>
    </Tooltip.Provider>
  );
}
