'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { loadPdfFromStorage, clearPdfFromStorage } from '@/lib/pdfStorage';

// We import types only — the engine modules are loaded dynamically
// because they require browser APIs (canvas, DecompressionStream)
import type { PDFDocumentData, RenderResult, TextRun } from '@/engine';

// ─── Tool types ─────────────────────────────────────────────────────────────

type EditorTool = 'select' | 'text' | 'highlight' | 'draw' | 'erase';

interface ToolDef {
  id: EditorTool;
  label: string;
  icon: string;
  shortcut: string;
}

const TOOLS: ToolDef[] = [
  { id: 'select',    label: 'Select',    icon: '⎋',  shortcut: 'V' },
  { id: 'text',      label: 'Edit Text', icon: '✎',  shortcut: 'T' },
  { id: 'highlight', label: 'Highlight', icon: '🖍', shortcut: 'H' },
  { id: 'draw',      label: 'Draw',      icon: '✏',  shortcut: 'D' },
  { id: 'erase',     label: 'Erase',     icon: '⌫',  shortcut: 'E' },
];

// ─── Coordinate helpers ─────────────────────────────────────────────────────

/** Convert a canvas CSS‐pixel mouse position to PDF user‐space coordinates. */
function canvasToPdf(
  cssX: number,
  cssY: number,
  scale: number,
  pageWidth: number,
  pageHeight: number,
  mediaBoxX: number,
  mediaBoxY: number,
): { pdfX: number; pdfY: number } {
  return {
    pdfX: cssX / scale + mediaBoxX,
    pdfY: (mediaBoxY + pageHeight) - cssY / scale,
  };
}

/** Convert PDF user‐space coordinates to canvas CSS pixels. */
function pdfToCanvas(
  pdfX: number,
  pdfY: number,
  scale: number,
  pageHeight: number,
  mediaBoxX: number,
  mediaBoxY: number,
): { cssX: number; cssY: number } {
  return {
    cssX: (pdfX - mediaBoxX) * scale,
    cssY: ((mediaBoxY + pageHeight) - pdfY) * scale,
  };
}

/** Hit-test: find the TextRun under a given PDF coordinate. */
function hitTestTextRuns(
  pdfX: number,
  pdfY: number,
  textRuns: TextRun[],
): TextRun | null {
  for (let i = textRuns.length - 1; i >= 0; i--) {
    const run = textRuns[i];
    if (run.glyphs.length === 0) continue;
    const first = run.glyphs[0];
    const last  = run.glyphs[run.glyphs.length - 1];
    const fontSize = first.fontSize || 12;
    const left   = Math.min(first.tRm.e, last.tRm.e) - 2;
    const right  = Math.max(first.tRm.e, last.tRm.e) + last.width + 2;
    const bottom = Math.min(first.tRm.f, last.tRm.f) - fontSize * 0.3;
    const top    = Math.max(first.tRm.f, last.tRm.f) + fontSize * 0.85;
    if (pdfX >= left && pdfX <= right && pdfY >= bottom && pdfY <= top) {
      return run;
    }
  }
  return null;
}

/**
 * Given a PDF X coordinate within a text run, find the character index
 * for caret placement (0 = before first char, glyphs.length = after last).
 */
function caretIndexFromPdfX(pdfX: number, run: TextRun): number {
  const glyphs = run.glyphs;
  if (glyphs.length === 0) return 0;
  // Walk through each glyph and find the midpoint boundary
  for (let i = 0; i < glyphs.length; i++) {
    const g = glyphs[i];
    const mid = g.tRm.e + g.width / 2;
    if (pdfX < mid) return i;
  }
  return glyphs.length;
}

// ─── Component ──────────────────────────────────────────────────────────────

export default function EditorPage() {
  const router = useRouter();

  // ── Core state ──
  const [doc, setDoc] = useState<PDFDocumentData | null>(null);
  const [fileName, setFileName] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.5);
  const [isLoading, setIsLoading] = useState(true);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);

  // ── Phase 4 state ──
  const [activeTool, setActiveTool] = useState<EditorTool>('text');
  const [selectedRun, setSelectedRun] = useState<TextRun | null>(null);
  const [editingRunState, setEditingRunState] = useState<TextRun | null>(null);
  const editingRunRef = useRef<TextRun | null>(null);
  const editingRun = editingRunState;
  const setEditingRun = useCallback((run: TextRun | null | ((prev: TextRun | null) => TextRun | null)) => {
    if (typeof run === 'function') {
      setEditingRunState((prev: TextRun | null) => {
        const next = run(prev);
        editingRunRef.current = next;
        return next;
      });
    } else {
      editingRunRef.current = run;
      setEditingRunState(run);
    }
  }, []);
  const initialRunTextRef = useRef<string>('');
  const [editText, setEditText] = useState('');
  const [caretPos, setCaretPos] = useState(0); // character index for caret
  const [isSaving, setIsSaving] = useState(false);
  const [renderKey, setRenderKey] = useState(0);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawPaths, setDrawPaths] = useState<{ x: number; y: number }[][]>([]);
  const currentDrawPath = useRef<{ x: number; y: number }[]>([]);

  // Caret blinking
  const caretVisibleRef = useRef(true);
  const caretTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Refs ──
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const hiddenInputRef = useRef<HTMLTextAreaElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const engineRef = useRef<typeof import('@/engine') | null>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Undo/Redo stacks — store content byte snapshots
  interface UndoEntry { pageIndex: number; contentBytes: Uint8Array }
  const undoStackRef = useRef<UndoEntry[]>([]);
  const redoStackRef = useRef<UndoEntry[]>([]);
  /** Snapshot of content bytes taken when user first starts editing a run */
  const undoSnapshotRef = useRef<UndoEntry | null>(null);

  // ── Load engine and PDF ──
  useEffect(() => {
    let cancelled = false;

    async function init() {
      try {
        const stored = await loadPdfFromStorage();
        if (!stored) { router.push('/'); return; }
        if (cancelled) return;
        setFileName(stored.fileName);

        const engine = await import('@/engine');
        engineRef.current = engine;

        const pdfBytes = new Uint8Array(stored.bytes);
        const parsed = await engine.parsePDF(pdfBytes);
        if (cancelled) return;

        setDoc(parsed);
        setTotalPages(parsed.pages.length);
        setCurrentPage(0);
        setIsLoading(false);
      } catch (e) {
        if (cancelled) return;
        console.error('[Editor] Init failed:', e);
        setError(`Failed to parse PDF: ${e instanceof Error ? e.message : String(e)}`);
        setIsLoading(false);
      }
    }

    init();
    return () => { cancelled = true; };
  }, [router]);

  // Reset edit state when doc or page changes
  useEffect(() => {
    setEditingRun(null);
    setSelectedRun(null);
    setEditText('');
  }, [doc, currentPage, setEditingRun]);

  // ── Render current page ──
  useEffect(() => {
    if (!doc || !engineRef.current) return;
    let cancelled = false;

    async function render() {
      setIsRendering(true);
      try {
        const engine = engineRef.current!;
        const result = await engine.renderPage(doc!, currentPage, { scale });
        if (cancelled) return;
        setRenderResult(result);

        // If we were editing a run, find its updated instance in result.textRuns
        if (editingRunRef.current) {
          const oldRun = editingRunRef.current;
          const newRun = result.textRuns.find((r: TextRun) =>
            r.fontName === oldRun.fontName &&
            Math.abs(r.y - oldRun.y) < 20 &&
            Math.abs(r.x - oldRun.x) < 50
          );
          if (newRun) {
            setEditingRun(newRun);
            setSelectedRun(newRun);
          } else {
            setEditingRun(null);
            setSelectedRun(null);
          }
        }

        // Mount canvas
        if (canvasContainerRef.current) {
          const wrapper = canvasContainerRef.current;
          // Remove old PDF canvas
          const oldCanvas = wrapper.querySelector('canvas.pdf-canvas');
          if (oldCanvas) oldCanvas.remove();

          result.canvas.className = 'pdf-canvas';
          result.canvas.style.display = 'block';
          result.canvas.style.position = 'relative';
          result.canvas.style.zIndex = '1';
          pdfCanvasRef.current = result.canvas;
          wrapper.prepend(result.canvas);

          // Size the overlay canvas to match
          const overlay = overlayRef.current;
          if (overlay) {
            const dpr = window.devicePixelRatio || 1;
            overlay.width = result.canvas.width;
            overlay.height = result.canvas.height;
            overlay.style.width = result.canvas.style.width;
            overlay.style.height = result.canvas.style.height;
          }
        }
      } catch (e) {
        if (cancelled) return;
        console.error('[Editor] Render failed:', e);
        setError(`Render failed: ${e instanceof Error ? e.message : String(e)}`);
      }
      setIsRendering(false);
    }

    render();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, currentPage, scale, renderKey]);

  // ── Draw overlay (caret, freehand paths) — NO boxes or highlights ──
  const drawOverlay = useCallback(() => {
    const overlay = overlayRef.current;
    if (!overlay || !renderResult) return;
    const ctx = overlay.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, overlay.width, overlay.height);

    const page = doc?.pages[currentPage];
    if (!page) return;
    const { mediaBox } = page;

    // ── If editing: ONLY show blinking caret (no box, no text masking, real PDF engine renders the font!) ──
    if (editingRun) {
      const glyphs = editingRun.glyphs;
      const fontSize = glyphs[0]?.fontSize || editingRun.fontSize || 12;

      ctx.save();
      ctx.scale(dpr, dpr);

      // Draw blinking caret exactly at character position
      if (caretVisibleRef.current) {
        let pdfX = editingRun.x;
        if (glyphs.length > 0) {
          if (caretPos <= 0) {
            pdfX = glyphs[0].tRm.e;
          } else if (caretPos <= glyphs.length) {
            const g = glyphs[caretPos - 1];
            pdfX = g.tRm.e + g.width;
          } else {
            const last = glyphs[glyphs.length - 1];
            pdfX = last.tRm.e + last.width + (caretPos - glyphs.length) * (fontSize * 0.5);
          }
        }

        const topCanvas = pdfToCanvas(
          pdfX,
          editingRun.y + fontSize * 0.85,
          scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
        );
        const bottomCanvas = pdfToCanvas(
          pdfX,
          editingRun.y - fontSize * 0.25,
          scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
        );

        const [r, g, b] = editingRun.fillColor || [0, 0, 0];
        ctx.strokeStyle = `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(topCanvas.cssX, topCanvas.cssY);
        ctx.lineTo(bottomCanvas.cssX, bottomCanvas.cssY);
        ctx.stroke();
      }

      ctx.restore();
    }

    // ── Freehand drawing paths ──
    if (drawPaths.length > 0) {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.strokeStyle = '#ff3b30';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const path of drawPaths) {
        if (path.length < 2) continue;
        ctx.beginPath();
        ctx.moveTo(path[0].x, path[0].y);
        for (let i = 1; i < path.length; i++) {
          ctx.lineTo(path[i].x, path[i].y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [editingRun, editText, caretPos, renderResult, doc, currentPage, scale, drawPaths]);

  // Re-draw overlay whenever edit state changes
  useEffect(() => { drawOverlay(); }, [drawOverlay]);

  // ── Caret blink timer ──
  useEffect(() => {
    if (editingRun) {
      caretVisibleRef.current = true;
      caretTimerRef.current = setInterval(() => {
        caretVisibleRef.current = !caretVisibleRef.current;
        drawOverlay();
      }, 530);
      return () => {
        if (caretTimerRef.current) clearInterval(caretTimerRef.current);
      };
    } else {
      caretVisibleRef.current = false;
      if (caretTimerRef.current) clearInterval(caretTimerRef.current);
    }
  }, [editingRun, drawOverlay]);

  // ── Focus hidden input when entering edit mode ──
  useEffect(() => {
    if (editingRun && hiddenInputRef.current) {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
      hiddenInputRef.current.focus({ preventScroll: true });
      const pos = caretPos;
      hiddenInputRef.current.setSelectionRange(pos, pos);
    }
  }, [editingRun, caretPos]);

  // ── Text edit submit ──
  const handleEditSubmit = useCallback(async (closeEdit: boolean = true) => {
    if (!editingRun || !doc || !engineRef.current) return;
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    try {
      setIsSaving(true);
      const engine = engineRef.current;
      const page = doc.pages[currentPage];
      const contentBytes = engine.getPageContentBytes(page, doc.objects);

      // Push undo snapshot (taken when editing began, or now if not yet taken)
      const snapshot = undoSnapshotRef.current;
      if (snapshot) {
        undoStackRef.current.push(snapshot);
        undoSnapshotRef.current = null;
      } else {
        // Fallback: snapshot current state
        undoStackRef.current.push({ pageIndex: currentPage, contentBytes: new Uint8Array(contentBytes) });
      }
      // Limit undo stack to 50 entries
      if (undoStackRef.current.length > 50) undoStackRef.current.shift();
      // Clear redo stack on new edit
      redoStackRef.current = [];

      const editResult = engine.applyTextEdits(
        contentBytes, page, doc.objects,
        [{ targetRun: editingRun, newText: editText }],
      );
      if (editResult.needsFontAugmentation) {
        console.warn('[Editor] Font augmentation needed for:', editResult.missingCharCodes);
      }
      await engine.updatePageContent(
        page.contentRefs, editResult.newContentBytes, doc.objects,
      );
      if (closeEdit) {
        setEditingRun(null);
        setSelectedRun(null);
      }
      setRenderKey(k => k + 1);
    } catch (e) {
      console.error('[Editor] Edit failed:', e);
      setError(`Edit failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [editingRun, editText, doc, currentPage]);

  // ── Edit cancel ──
  const handleEditCancel = useCallback(async () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    if (editingRun && doc && engineRef.current && editText !== initialRunTextRef.current && initialRunTextRef.current !== '') {
      try {
        const engine = engineRef.current;
        const page = doc.pages[currentPage];
        const contentBytes = engine.getPageContentBytes(page, doc.objects);
        const editResult = engine.applyTextEdits(
          contentBytes, page, doc.objects,
          [{ targetRun: editingRun, newText: initialRunTextRef.current }],
        );
        await engine.updatePageContent(
          page.contentRefs, editResult.newContentBytes, doc.objects,
        );
        setRenderKey(k => k + 1);
      } catch (e) {
        console.warn('[Editor] Revert on cancel failed:', e);
      }
    }
    undoSnapshotRef.current = null;
    setEditingRun(null);
    setSelectedRun(null);
    setEditText('');
    setCaretPos(0);
  }, [editingRun, editText, doc, currentPage, setEditingRun]);

  // ── Undo ──
  const handleUndo = useCallback(async () => {
    if (!doc || !engineRef.current) return;
    const entry = undoStackRef.current.pop();
    if (!entry) return;
    try {
      const engine = engineRef.current;
      const page = doc.pages[entry.pageIndex];
      // Save current state to redo stack
      const currentBytes = engine.getPageContentBytes(page, doc.objects);
      redoStackRef.current.push({ pageIndex: entry.pageIndex, contentBytes: new Uint8Array(currentBytes) });
      // Restore the old content bytes
      await engine.updatePageContent(page.contentRefs, entry.contentBytes, doc.objects);
      // Exit editing mode and re-render
      undoSnapshotRef.current = null;
      setEditingRun(null);
      setSelectedRun(null);
      setEditText('');
      setCaretPos(0);
      setRenderKey(k => k + 1);
    } catch (e) {
      console.error('[Editor] Undo failed:', e);
    }
  }, [doc, setEditingRun]);

  // ── Redo ──
  const handleRedo = useCallback(async () => {
    if (!doc || !engineRef.current) return;
    const entry = redoStackRef.current.pop();
    if (!entry) return;
    try {
      const engine = engineRef.current;
      const page = doc.pages[entry.pageIndex];
      // Save current state to undo stack
      const currentBytes = engine.getPageContentBytes(page, doc.objects);
      undoStackRef.current.push({ pageIndex: entry.pageIndex, contentBytes: new Uint8Array(currentBytes) });
      // Restore the redo content bytes
      await engine.updatePageContent(page.contentRefs, entry.contentBytes, doc.objects);
      // Exit editing mode and re-render
      undoSnapshotRef.current = null;
      setEditingRun(null);
      setSelectedRun(null);
      setEditText('');
      setCaretPos(0);
      setRenderKey(k => k + 1);
    } catch (e) {
      console.error('[Editor] Redo failed:', e);
    }
  }, [doc, setEditingRun]);

  // ── Global keyboard shortcuts for undo/redo ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
        e.preventDefault();
        handleRedo();
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [handleUndo, handleRedo]);

  // ── Canvas click handler — caret-based, no boxes ──
  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (!renderResult || !doc) return;
    const wrapper = canvasContainerRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const page = doc.pages[currentPage];
    const { mediaBox } = page;
    const { pdfX, pdfY } = canvasToPdf(
      cssX, cssY, scale,
      renderResult.pageWidth, renderResult.pageHeight,
      mediaBox.x, mediaBox.y,
    );

    if (activeTool === 'text' || activeTool === 'select') {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
      const hit = hitTestTextRuns(pdfX, pdfY, renderResult.textRuns);
      if (hit) {
        const newCaret = caretIndexFromPdfX(pdfX, hit);
        if (editingRun === hit) {
          // Already editing this run — reposition caret
          setCaretPos(newCaret);
          caretVisibleRef.current = true; // reset blink
        } else {
          // Commit any previous edit first without closing edit mode
          if (editingRun) {
            handleEditSubmit(false);
          }
          // Enter editing on the new run
          initialRunTextRef.current = hit.text;
          setActiveTool('text');
          setSelectedRun(hit);
          setEditingRun(hit);
          setEditText(hit.text);
          setCaretPos(newCaret);
        }
        // Focus the hidden input and sync selection position
        setTimeout(() => {
          if (hiddenInputRef.current) {
            hiddenInputRef.current.focus({ preventScroll: true });
            hiddenInputRef.current.setSelectionRange(newCaret, newCaret);
          }
        }, 0);
      } else {
        // Clicked on empty space — commit and exit
        if (editingRun) {
          handleEditSubmit();
        } else {
          setEditingRun(null);
          setSelectedRun(null);
        }
      }
    } else if (activeTool === 'highlight') {
      const hit = hitTestTextRuns(pdfX, pdfY, renderResult.textRuns);
      if (hit) setSelectedRun(hit);
    }
  }, [renderResult, doc, currentPage, scale, activeTool, editingRun, handleEditSubmit, setEditingRun]);

  // Double-click in select mode → enter text edit
  const handleCanvasDoubleClick = useCallback((e: React.MouseEvent) => {
    if (activeTool !== 'select' && activeTool !== 'text') return;
    if (!renderResult || !doc) return;
    const wrapper = canvasContainerRef.current;
    if (!wrapper) return;
    const rect = wrapper.getBoundingClientRect();
    const cssX = e.clientX - rect.left;
    const cssY = e.clientY - rect.top;
    const page = doc.pages[currentPage];
    const { mediaBox } = page;
    const { pdfX, pdfY } = canvasToPdf(
      cssX, cssY, scale,
      renderResult.pageWidth, renderResult.pageHeight,
      mediaBox.x, mediaBox.y,
    );
    const hit = hitTestTextRuns(pdfX, pdfY, renderResult.textRuns);
    if (hit) {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
      if (editingRun && editingRun !== hit) {
        handleEditSubmit(false);
      }
      const newCaret = caretIndexFromPdfX(pdfX, hit);
      initialRunTextRef.current = hit.text;
      setActiveTool('text');
      setSelectedRun(hit);
      setEditingRun(hit);
      setEditText(hit.text);
      setCaretPos(newCaret);
      setTimeout(() => {
        if (hiddenInputRef.current) {
          hiddenInputRef.current.focus({ preventScroll: true });
          hiddenInputRef.current.setSelectionRange(newCaret, newCaret);
        }
      }, 0);
    }
  }, [renderResult, doc, currentPage, scale, activeTool, editingRun, handleEditSubmit, setEditingRun]);

  // ── Drawing handlers ──
  const handleDrawStart = useCallback((e: React.MouseEvent) => {
    if (activeTool !== 'draw') return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsDrawing(true);
    currentDrawPath.current = [{ x, y }];
  }, [activeTool]);

  const handleDrawMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing || activeTool !== 'draw') return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    currentDrawPath.current.push({ x, y });

    // Live draw on overlay
    const ctx = overlay.getContext('2d');
    if (ctx) {
      const dpr = window.devicePixelRatio || 1;
      const path = currentDrawPath.current;
      if (path.length >= 2) {
        ctx.save();
        ctx.scale(dpr, dpr);
        ctx.strokeStyle = '#ff3b30';
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        const prev = path[path.length - 2];
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.restore();
      }
    }
  }, [isDrawing, activeTool]);

  const handleDrawEnd = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);
    if (currentDrawPath.current.length > 1) {
      setDrawPaths(prev => [...prev, [...currentDrawPath.current]]);
    }
    currentDrawPath.current = [];
  }, [isDrawing]);

  // ── Hidden input handler — this is where all typing is captured ──
  const handleHiddenInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    if (!editingRun || !doc || !engineRef.current) return;
    const newVal = (e.target as HTMLTextAreaElement).value;
    setEditText(newVal);
    // Sync caret to the hidden textarea's selectionStart
    const sel = (e.target as HTMLTextAreaElement).selectionStart ?? newVal.length;
    setCaretPos(sel);
    caretVisibleRef.current = true; // reset blink on typing

    const updatedRun = { ...editingRun, text: newVal };

    // Live update the PDF stream and re-render using the real PDF engine!
    try {
      const engine = engineRef.current;
      const page = doc.pages[currentPage];
      const contentBytes = engine.getPageContentBytes(page, doc.objects);

      // Snapshot content bytes BEFORE the first live keystroke for undo
      if (!undoSnapshotRef.current) {
        undoSnapshotRef.current = { pageIndex: currentPage, contentBytes: new Uint8Array(contentBytes) };
      }

      const editResult = engine.applyTextEdits(
        contentBytes, page, doc.objects,
        [{ targetRun: editingRun, newText: newVal }],
      );
      if (editResult.needsFontAugmentation) {
        console.warn('[Editor] Font augmentation needed for:', editResult.missingCharCodes);
      }
      engine.updatePageContent(
        page.contentRefs, editResult.newContentBytes, doc.objects,
      ).then(() => {
        setRenderKey(k => k + 1);
      });
    } catch (err) {
      console.warn('[Editor] Live edit apply failed:', err);
    }

    setEditingRun(updatedRun);
  }, [editingRun, doc, currentPage, setEditingRun]);

  const handleHiddenKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Undo/Redo — intercept before other handlers
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      handleUndo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      handleRedo();
      return;
    }
    if (!editingRun) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleEditCancel();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      // Let the hidden textarea handle cursor movement, then sync
      setTimeout(() => {
        const sel = hiddenInputRef.current?.selectionStart ?? caretPos;
        setCaretPos(sel);
        caretVisibleRef.current = true;
      }, 0);
    }
  }, [editingRun, caretPos, handleEditSubmit, handleEditCancel, handleUndo, handleRedo]);

  const handleHiddenBlur = useCallback(() => {
    if (!editingRun) return;
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }
    // Small delay so clicks on canvas can be processed first without terminating edit mode
    blurTimeoutRef.current = setTimeout(() => {
      blurTimeoutRef.current = null;
      if (editingRunRef.current) {
        handleEditSubmit();
      }
    }, 150);
  }, [editingRun, handleEditSubmit]);

  // ── Navigation handlers ──
  const goToPrev = useCallback(() => {
    setCurrentPage(p => Math.max(0, p - 1));
  }, []);

  const goToNext = useCallback(() => {
    setCurrentPage(p => Math.min(totalPages - 1, p + 1));
  }, [totalPages]);

  const zoomIn = useCallback(() => {
    setScale(s => Math.min(4, s + 0.25));
  }, []);

  const zoomOut = useCallback(() => {
    setScale(s => Math.max(0.5, s - 0.25));
  }, []);

  // ── Download / Save ──
  const handleDownload = useCallback(async () => {
    if (!doc || !engineRef.current) return;
    try {
      setIsSaving(true);
      const engine = engineRef.current;
      const bytes = await engine.serializeDocument(doc);
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'edited.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('[Editor] Download failed:', e);
      setError(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [doc, fileName]);

  const handleClose = useCallback(async () => {
    await clearPdfFromStorage();
    router.push('/');
  }, [router]);

  // ── Keyboard shortcuts (global — NOT during editing) ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't intercept when the hidden input has focus (editing)
      if (editingRun) return;

      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault(); goToPrev();
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault(); goToNext();
      } else if ((e.key === '+' || e.key === '=') && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); zoomIn();
      } else if (e.key === '-' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault(); zoomOut();
      } else if (e.key === 'v' || e.key === 'V') {
        setActiveTool('select');
      } else if (e.key === 't' || e.key === 'T') {
        setActiveTool('text');
      } else if (e.key === 'h' || e.key === 'H') {
        if (!e.metaKey && !e.ctrlKey) setActiveTool('highlight');
      } else if (e.key === 'd') {
        setActiveTool('draw');
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [goToPrev, goToNext, zoomIn, zoomOut, editingRun]);

  // ── Loading state ──
  if (isLoading) {
    return (
      <div style={S.center}>
        <div style={S.spinner} />
        <p style={{ color: '#888', marginTop: 16, fontSize: 14, fontFamily: 'system-ui' }}>
          Parsing PDF with our engine…
        </p>
        <style>{spinnerCSS}</style>
      </div>
    );
  }

  // ── Error state ──
  if (error && !doc) {
    return (
      <div style={S.center}>
        <p style={{ color: '#ff453a', fontSize: 15, maxWidth: 400, textAlign: 'center', lineHeight: 1.6 }}>
          {error}
        </p>
        <button onClick={handleClose} style={S.btn}>← Go Back</button>
      </div>
    );
  }

  const cursorForTool = activeTool === 'text' ? 'text' : activeTool === 'draw' ? 'crosshair' : activeTool === 'highlight' ? 'pointer' : 'default';

  // ── Main editor UI ──
  return (
    <div style={S.layout}>
      {/* ── Top toolbar ── */}
      <div style={S.toolbar}>
        <div style={S.toolbarGroup}>
          <button onClick={handleClose} style={S.toolBtn} title="Close file">✕</button>
          <span style={S.fileName}>{fileName}</span>
        </div>

        <div style={S.toolbarGroup}>
          <button onClick={goToPrev} disabled={currentPage === 0} style={S.toolBtn}>◀</button>
          <span style={S.pageInfo}>{currentPage + 1} / {totalPages}</span>
          <button onClick={goToNext} disabled={currentPage >= totalPages - 1} style={S.toolBtn}>▶</button>

          <span style={S.separator} />

          <button onClick={zoomOut} disabled={scale <= 0.5} style={S.toolBtn}>−</button>
          <span style={S.zoomInfo}>{Math.round(scale * 100)}%</span>
          <button onClick={zoomIn} disabled={scale >= 4} style={S.toolBtn}>+</button>
        </div>

        <div style={S.toolbarGroup}>
          {drawPaths.length > 0 && (
            <button
              onClick={() => setDrawPaths([])}
              style={{ ...S.toolBtn, color: '#ff6b6b', borderColor: '#5c2228' }}
              title="Clear drawings"
            >
              Clear
            </button>
          )}
          <button
            onClick={handleDownload}
            disabled={isSaving}
            style={{ ...S.toolBtn, color: '#30d158', borderColor: '#1a4a28' }}
            title="Download PDF"
          >
            {isSaving ? '…' : '↓ Save'}
          </button>
        </div>
      </div>

      <div style={S.mainArea}>
        {/* ── Left sidebar ── */}
        <div style={S.sidebar}>
          {TOOLS.map((tool) => (
            <button
              key={tool.id}
              onClick={() => setActiveTool(tool.id)}
              title={`${tool.label} (${tool.shortcut})`}
              style={{
                ...S.sidebarBtn,
                background: activeTool === tool.id ? 'rgba(41, 151, 255, 0.15)' : 'transparent',
                color: activeTool === tool.id ? '#2997ff' : '#888',
                borderLeft: activeTool === tool.id ? '2px solid #2997ff' : '2px solid transparent',
              }}
            >
              <span style={{ fontSize: 18, lineHeight: 1 }}>{tool.icon}</span>
              <span style={{ fontSize: 9, marginTop: 2, letterSpacing: '0.02em' }}>{tool.label}</span>
            </button>
          ))}
        </div>

        {/* ── Canvas area ── */}
        <div style={S.canvasArea}>
          {isRendering && (
            <div style={S.renderingOverlay}>
              <div style={S.spinnerSmall} />
            </div>
          )}

          <div
            ref={canvasContainerRef}
            style={{ ...S.canvasWrapper, cursor: cursorForTool }}
            onClick={handleCanvasClick}
            onDoubleClick={handleCanvasDoubleClick}
            onMouseDown={handleDrawStart}
            onMouseMove={handleDrawMove}
            onMouseUp={handleDrawEnd}
            onMouseLeave={handleDrawEnd}
          >
            {/* PDF canvas is prepended here by the render effect */}

            {/* Overlay canvas for caret / drawings — NO selection boxes */}
            <canvas
              ref={overlayRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                zIndex: 10,
                pointerEvents: activeTool === 'draw' ? 'auto' : 'none',
              }}
            />

            {/* Hidden input — captures all keystrokes invisibly */}
            <textarea
              ref={hiddenInputRef}
              value={editText}
              onInput={handleHiddenInput}
              onKeyDown={handleHiddenKeyDown}
              onBlur={handleHiddenBlur}
              aria-label="Text editing input"
              style={{
                position: 'fixed',
                left: 0,
                top: 0,
                width: 1,
                height: 1,
                opacity: 0,
                pointerEvents: 'none',
                padding: 0,
                border: 'none',
                outline: 'none',
                resize: 'none',
                overflow: 'hidden',
                zIndex: -1,
              }}
            />
          </div>
        </div>
      </div>

      {/* ── Bottom status bar ── */}
      <div style={S.statusBar}>
        <span style={S.statusText}>
          {renderResult
            ? `${renderResult.pageWidth.toFixed(0)} × ${renderResult.pageHeight.toFixed(0)} pt`
            : ''}
        </span>
        <span style={S.statusText}>
          Tool: <b style={{ color: '#aaa' }}>{TOOLS.find(t => t.id === activeTool)?.label}</b>
          {selectedRun && (
            <> &nbsp;|&nbsp; Selected: &quot;{selectedRun.text.substring(0, 30)}
            {selectedRun.text.length > 30 ? '…' : ''}&quot;</>
          )}
        </span>
        <span style={S.statusText}>
          {renderResult ? `${renderResult.textRuns.length} text runs` : ''}
          {doc ? ` | ${totalPages} pages | v${doc.version}` : ''}
        </span>
      </div>

      {/* Error toast */}
      {error && (
        <div style={S.errorToast}>
          {error}
          <button onClick={() => setError(null)} style={S.errorClose}>✕</button>
        </div>
      )}

      <style>{spinnerCSS}</style>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const S: Record<string, React.CSSProperties> = {
  center: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'system-ui',
  },
  spinner: {
    width: 40,
    height: 40,
    border: '3px solid #333',
    borderTopColor: '#2997ff',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  spinnerSmall: {
    width: 24,
    height: 24,
    border: '2px solid #333',
    borderTopColor: '#2997ff',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  layout: {
    display: 'flex',
    flexDirection: 'column',
    height: '100vh',
    fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
    background: '#0d0d0d',
    color: '#f5f5f7',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 12px',
    height: 48,
    background: '#161616',
    borderBottom: '1px solid #222',
    flexShrink: 0,
  },
  toolbarGroup: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  toolBtn: {
    background: 'none',
    border: '1px solid #333',
    color: '#ccc',
    padding: '4px 10px',
    borderRadius: 4,
    cursor: 'pointer',
    fontSize: 13,
    fontFamily: 'system-ui',
    lineHeight: '20px',
    transition: 'all 0.15s ease',
  },
  btn: {
    background: 'none',
    border: '1px solid #444',
    color: '#ccc',
    padding: '8px 20px',
    borderRadius: 6,
    cursor: 'pointer',
    fontSize: 14,
    marginTop: 20,
    fontFamily: 'system-ui',
  },
  fileName: {
    color: '#888',
    fontSize: 13,
    maxWidth: 200,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  pageInfo: {
    color: '#aaa',
    fontSize: 13,
    minWidth: 60,
    textAlign: 'center',
  },
  zoomInfo: {
    color: '#aaa',
    fontSize: 12,
    minWidth: 44,
    textAlign: 'center',
  },
  separator: {
    width: 1,
    height: 20,
    background: '#333',
    margin: '0 6px',
  },
  mainArea: {
    flex: 1,
    display: 'flex',
    overflow: 'hidden',
  },
  sidebar: {
    width: 56,
    background: '#111',
    borderRight: '1px solid #222',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    paddingTop: 8,
    gap: 2,
    flexShrink: 0,
  },
  sidebarBtn: {
    width: 52,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '8px 4px',
    border: 'none',
    cursor: 'pointer',
    borderRadius: '0 4px 4px 0',
    transition: 'all 0.15s ease',
    fontFamily: 'system-ui',
  },
  canvasArea: {
    flex: 1,
    overflow: 'auto',
    background: '#1a1a1a',
    position: 'relative',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'flex-start',
    padding: '24px 0',
  },
  canvasWrapper: {
    position: 'relative',
    display: 'inline-block',
    flexShrink: 0,
  },
  renderingOverlay: {
    position: 'absolute',
    top: 12,
    right: 12,
    zIndex: 30,
    background: 'rgba(0,0,0,0.6)',
    borderRadius: 8,
    padding: 8,
  },
  editTextarea: {
    width: '100%',
    minHeight: '100%',
    background: 'rgba(255, 255, 255, 0.95)',
    color: '#111',
    border: '2px solid #2997ff',
    borderRadius: 3,
    padding: '2px 4px',
    fontSize: 14,
    fontFamily: 'inherit',
    resize: 'both',
    outline: 'none',
    boxShadow: '0 2px 12px rgba(41, 151, 255, 0.3)',
  },
  editActions: {
    display: 'flex',
    gap: 4,
    marginTop: 4,
    justifyContent: 'flex-end',
  },
  editBtnSave: {
    background: '#2997ff',
    color: '#fff',
    border: 'none',
    borderRadius: 3,
    padding: '2px 10px',
    cursor: 'pointer',
    fontSize: 13,
    fontWeight: 600,
  },
  editBtnCancel: {
    background: '#333',
    color: '#ccc',
    border: 'none',
    borderRadius: 3,
    padding: '2px 10px',
    cursor: 'pointer',
    fontSize: 13,
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    height: 28,
    background: '#0a0a0a',
    borderTop: '1px solid #1a1a1a',
    flexShrink: 0,
  },
  statusText: {
    color: '#555',
    fontSize: 11,
  },
  errorToast: {
    position: 'fixed',
    bottom: 40,
    left: '50%',
    transform: 'translateX(-50%)',
    background: '#2a1215',
    border: '1px solid #5c2228',
    color: '#ff6b6b',
    padding: '8px 16px',
    borderRadius: 8,
    fontSize: 13,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    zIndex: 100,
  },
  errorClose: {
    background: 'none',
    border: 'none',
    color: '#ff6b6b',
    cursor: 'pointer',
    fontSize: 14,
    padding: 0,
  },
};

const spinnerCSS = `@keyframes spin { to { transform: rotate(360deg); } }`;
