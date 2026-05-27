'use client';

import { useCallback, useEffect, useRef } from 'react';
import * as fabric from 'fabric';
import { useEditorStore } from '@/store/editorStore';
import Toolbar from './Toolbar';
import Sidebar from './Sidebar';
import PageCanvas from './PageCanvas';
import SignatureDialog from '@/components/dialogs/SignatureDialog';
import SearchDialog from '@/components/dialogs/SearchDialog';
import WatermarkDialog from '@/components/dialogs/WatermarkDialog';
import ExportDialog from '@/components/dialogs/ExportDialog';
import PageManagerDialog from '@/components/dialogs/PageManagerDialog';
import { exportPdfWithOverlays, addWatermarkToPdf } from '@/lib/pdfUtils';
import { downloadBlob } from '@/lib/utils';

export default function EditorLayout() {
  const store = useEditorStore();
  const pageListRef = useRef<HTMLDivElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  // Track per-page fabric canvas refs for signature/image insertion
  const canvasRefs = useRef<Record<number, fabric.Canvas>>({});

  const {
    pdfFile,
    pdfBytes,
    pageCount,
    currentPage,
    activeTool,
    toolOptions,
    pageOverlays,
    textEdits,
    undoStack,
    redoStack,
    zoom,
    sidebarOpen,
    signatureDialogOpen,
    searchOpen,
    watermarkDialogOpen,
    exportDialogOpen,
    pageManagerOpen,
  } = store;

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      if (isInput) return;

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('pdf-editor:undo'));
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) {
        e.preventDefault();
        window.dispatchEvent(new CustomEvent('pdf-editor:redo'));
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        store.setSearchOpen(true);
      }
      if (e.key === 'v' || e.key === 'V') store.setActiveTool('select');
      if (e.key === 't' || e.key === 'T') store.setActiveTool('text');
      if (e.key === 'd' || e.key === 'D') store.setActiveTool('draw');
      if (e.key === 'e' || e.key === 'E') store.setActiveTool('eraser');
      if (e.key === 'h' || e.key === 'H') store.setActiveTool('highlight');
      if (e.key === 's' || e.key === 'S') store.setSignatureDialogOpen(true);
      if (e.key === 'Escape') {
        store.setSearchOpen(false);
        store.setSignatureDialogOpen(false);
        store.setWatermarkDialogOpen(false);
        store.setExportDialogOpen(false);
        store.setPageManagerOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [store]);

  // ── Scroll to current page ──────────────────────────────────────────────
  useEffect(() => {
    const el = pageListRef.current?.querySelector(`[data-page="${currentPage}"]`);
    el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [currentPage]);

  // ── Overlay change handler ──────────────────────────────────────────────
  const handleOverlayChange = useCallback(
    (pageIndex: number, json: string) => {
      store.setPageOverlay(pageIndex, json);
    },
    [store]
  );

  const handleHistoryPush = useCallback(
    (pageIndex: number, json: string) => {
      store.pushHistory({ pageIndex, json });
    },
    [store]
  );

  // ── Signature application ────────────────────────────────────────────────
  const handleSignatureApply = useCallback(
    (dataUrl: string) => {
      // Place signature on current page via fabric canvas
      const pageIndex = currentPage - 1;
      // We broadcast to PageCanvas via a special overlay event
      // For now we dispatch via store
      store.setActiveTool('select');
      // Store the pending signature in a custom property we handle in PageCanvas
      // Alternative: inject directly via a ref callback
      const event = new CustomEvent('pdf-editor:insert-image', {
        detail: { dataUrl, pageIndex },
      });
      window.dispatchEvent(event);
    },
    [currentPage, store]
  );

  // ── Image insertion ──────────────────────────────────────────────────────
  const handleImageFile = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target?.result as string;
        const pageIndex = currentPage - 1;
        const event = new CustomEvent('pdf-editor:insert-image', {
          detail: { dataUrl, pageIndex },
        });
        window.dispatchEvent(event);
      };
      reader.readAsDataURL(file);
      e.target.value = '';
    },
    [currentPage]
  );

  // ── Watermark ────────────────────────────────────────────────────────────
  const handleWatermarkApply = useCallback(
    async (opts: {
      text: string;
      fontSize: number;
      color: [number, number, number];
      opacity: number;
      angle: number;
      repeat: boolean;
    }) => {
      if (!pdfBytes) return;
      const bytes = new Uint8Array(pdfBytes);
      const result = await addWatermarkToPdf(bytes, opts.text, opts);
      const blob = new Blob([result.buffer as ArrayBuffer], { type: 'application/pdf' });
      downloadBlob(blob, (pdfFile?.name ?? 'document').replace(/\.pdf$/i, '') + '-watermarked.pdf');
    },
    [pdfBytes, pdfFile]
  );

  // ── Export ───────────────────────────────────────────────────────────────
  const handleExport = useCallback(async (): Promise<Uint8Array> => {
    if (!pdfBytes) throw new Error('No PDF loaded');

    // Trigger all pages to update their data URLs
    const event = new CustomEvent('pdf-editor:request-snapshot');
    window.dispatchEvent(event);
    // Small delay to allow canvases to emit their updated snapshots
    await new Promise((r) => setTimeout(r, 300));

    return exportPdfWithOverlays(pdfBytes, pageOverlays, textEdits);
  }, [pdfBytes, pageOverlays, textEdits]);

  // ── Page manager apply ───────────────────────────────────────────────────
  const handlePageManagerApply = useCallback(
    (order: number[], deleted: Set<number>, rotations: Record<number, number>) => {
      // Reorder overlays to match new page order
      const newOverlays: typeof pageOverlays = {};
      order.forEach((origIdx, newIdx) => {
        const overlay = pageOverlays[origIdx];
        if (overlay) newOverlays[newIdx] = overlay;
      });
      // Apply by updating store (conceptually reorder pages in pdfBytes)
      // For a full implementation, pdf-lib reorder would be triggered on export
      // For now we persist the intent in a store extension
      Object.entries(newOverlays).forEach(([idx, ov]) => {
        store.setPageOverlay(Number(idx), ov.json);
      });
    },
    [pageOverlays, store]
  );

  if (!pdfBytes || !pdfFile) return null;

  return (
    <div className="flex flex-col h-screen bg-zinc-950 text-white overflow-hidden">
      {/* Top toolbar */}
      <Toolbar
        activeTool={activeTool}
        toolOptions={toolOptions}
        zoom={zoom}
        canUndo={undoStack.length > 0}
        canRedo={redoStack.length > 0}
        fileName={pdfFile.name}
        onToolChange={store.setActiveTool}
        onToolOptionChange={store.setToolOption}
        onZoomChange={store.setZoom}
        onUndo={() => window.dispatchEvent(new CustomEvent('pdf-editor:undo'))}
        onRedo={() => window.dispatchEvent(new CustomEvent('pdf-editor:redo'))}
        onDeleteSelected={() => window.dispatchEvent(new CustomEvent('pdf-editor:delete-selection'))}
        onSearch={() => store.setSearchOpen(true)}
        onWatermark={() => store.setWatermarkDialogOpen(true)}
        onExport={() => store.setExportDialogOpen(true)}
        onPageManager={() => store.setPageManagerOpen(true)}
        onImageInsert={() => imageInputRef.current?.click()}
        onSignature={() => store.setSignatureDialogOpen(true)}
      />

      {/* Body: sidebar + canvas area */}
      <div className="flex flex-1 overflow-hidden">
        {sidebarOpen && (
          <Sidebar
            pdfBytes={pdfBytes}
            pageCount={pageCount}
            currentPage={currentPage}
            onPageSelect={store.setCurrentPage}
          />
        )}

        {/* Canvas scroll area */}
        <div
          ref={pageListRef}
          className="flex-1 overflow-y-auto bg-zinc-800 flex flex-col items-center gap-8 p-8"
          onClick={() => store.setSidebarOpen(sidebarOpen)}
        >
          {Array.from({ length: pageCount }, (_, i) => (
            <div
              key={i}
              data-page={i + 1}
              onClick={() => store.setCurrentPage(i + 1)}
              className="cursor-pointer"
            >
              <PageCanvas
                pageIndex={i}
                pdfBytes={pdfBytes}
                scale={zoom * 1.5}
                activeTool={activeTool}
                toolOptions={toolOptions}
                overlayJson={pageOverlays[i]?.json}
                textEdits={textEdits[i] ?? {}}
                isCurrentPage={currentPage === i + 1}
                onOverlayChange={handleOverlayChange}
                onHistoryPush={handleHistoryPush}
                onTextEdit={store.setTextEdit}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Hidden image input */}
      <input ref={imageInputRef} type="file" accept="image/*" className="hidden" onChange={handleImageFile} />

      {/* Dialogs */}
      <SignatureDialog
        open={signatureDialogOpen}
        onClose={() => store.setSignatureDialogOpen(false)}
        onApply={handleSignatureApply}
      />
      <SearchDialog
        open={searchOpen}
        pdfBytes={pdfBytes}
        onClose={() => store.setSearchOpen(false)}
      />
      <WatermarkDialog
        open={watermarkDialogOpen}
        onClose={() => store.setWatermarkDialogOpen(false)}
        onApply={handleWatermarkApply}
      />
      <ExportDialog
        open={exportDialogOpen}
        fileName={pdfFile.name}
        onClose={() => store.setExportDialogOpen(false)}
        onExportPdf={handleExport}
      />
      <PageManagerDialog
        open={pageManagerOpen}
        pdfBytes={pdfBytes}
        pageCount={pageCount}
        onClose={() => store.setPageManagerOpen(false)}
        onApply={handlePageManagerApply}
      />
    </div>
  );
}
