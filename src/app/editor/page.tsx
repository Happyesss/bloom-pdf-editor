'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { loadPdfFromStorage, clearPdfFromStorage } from '@/lib/pdfStorage';
import { 
  MousePointer2, 
  Type, 
  TextCursorInput, 
  Highlighter, 
  PenTool, 
  Eraser, 
  Download, 
  X, 
  ZoomIn, 
  ZoomOut,
  ChevronLeft,
  ChevronRight,
  Loader2,
  Image,
  Trash2,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Minus,
  Plus,
  Layers
} from 'lucide-react';

// We import types only — the engine modules are loaded dynamically
// because they require browser APIs (canvas, DecompressionStream)
import type { PDFDocumentData, RenderResult, TextRun, ImageItem, PathItem, DisplayItem } from '@/engine';

// ─── Tool types ─────────────────────────────────────────────────────────────

type EditorTool = 'select' | 'text' | 'addtext' | 'highlight' | 'draw' | 'erase';

interface ToolDef {
  id: EditorTool;
  label: string;
  icon: React.ReactNode;
  shortcut: string;
}

const TOOLS: ToolDef[] = [
  { id: 'select',    label: 'Select',    icon: <MousePointer2 size={18} />,  shortcut: 'V' },
  { id: 'text',      label: 'Edit Text', icon: <Type size={18} />,  shortcut: 'T' },
  { id: 'addtext',   label: 'Add Text',  icon: <TextCursorInput size={18} />,  shortcut: 'A' },
  { id: 'highlight', label: 'Highlight', icon: <Highlighter size={18} />, shortcut: 'H' },
  { id: 'draw',      label: 'Draw',      icon: <PenTool size={18} />,  shortcut: 'D' },
  { id: 'erase',     label: 'Erase',     icon: <Eraser size={18} />,  shortcut: 'E' },
];

export type PathType = 'draw' | 'highlight';

export interface DrawnPath {
  id: string;
  type: PathType;
  color: string;
  size: number;
  points: { x: number; y: number }[];
}

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

/** Hit-test: find an ImageItem or PathItem under a PDF coordinate. */
function hitTestDisplayItems(
  pdfX: number,
  pdfY: number,
  items: (ImageItem | PathItem)[],
): ImageItem | PathItem | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i];
    if (item.width <= 0 || item.height <= 0) continue;
    if (
      pdfX >= item.x && pdfX <= item.x + item.width &&
      pdfY >= item.y && pdfY <= item.y + item.height
    ) {
      return item;
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

/** Convert #RRGGBB to [r,g,b] where each is 0-1 */
function hexToRGB(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  if (clean.length === 3) {
    return [
      parseInt(clean[0]+clean[0], 16) / 255,
      parseInt(clean[1]+clean[1], 16) / 255,
      parseInt(clean[2]+clean[2], 16) / 255,
    ];
  }
  return [
    parseInt(clean.substring(0,2), 16) / 255,
    parseInt(clean.substring(2,4), 16) / 255,
    parseInt(clean.substring(4,6), 16) / 255,
  ];
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
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);

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
  const [drawnPaths, setDrawnPaths] = useState<DrawnPath[]>([]);
  const currentDrawPath = useRef<{ x: number; y: number }[]>([]);

  // Tool properties
  const [drawColor, setDrawColor] = useState('#ff3b30');
  const [drawSize, setDrawSize] = useState(2);
  const [highlightColor, setHighlightColor] = useState('#fffb00');
  const [highlightSize, setHighlightSize] = useState(16);
  const [eraserSize, setEraserSize] = useState(20);

  // Display items (images/paths) for selection overlays
  const [displayItems, setDisplayItems] = useState<(ImageItem | PathItem)[]>([]);
  const [selectedDisplayItem, setSelectedDisplayItem] = useState<ImageItem | PathItem | null>(null);

  // Text properties sidebar state
  const [textFontFamily, setTextFontFamily] = useState('Helvetica');
  const [textFontSize, setTextFontSize] = useState(12);
  const [textColor, setTextColor] = useState('#000000');
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('left');
  const [textOpacity, setTextOpacity] = useState(100);

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

  // ── Generate thumbnails ──
  useEffect(() => {
    if (!doc || !engineRef.current) return;
    let cancelled = false;

    async function generateThumbnails() {
      setIsGeneratingThumbnails(true);
      const engine = engineRef.current!;
      const thumbs: string[] = [];
      
      try {
        for (let i = 0; i < doc!.pages.length; i++) {
          if (cancelled) break;
          // Render at 15% scale for a quick thumbnail
          const res = await engine.renderPage(doc!, i, { scale: 0.15, renderText: true, renderPaths: true, renderImages: true });
          if (cancelled) break;
          thumbs.push(res.canvas.toDataURL('image/jpeg', 0.6));
        }
        if (!cancelled) setThumbnails(thumbs);
      } catch (e) {
        console.error('[Editor] Thumbnail generation failed:', e);
      } finally {
        if (!cancelled) setIsGeneratingThumbnails(false);
      }
    }

    generateThumbnails();
    return () => { cancelled = true; };
  }, [doc]);

  // Reset edit state when doc or page changes
  useEffect(() => {
    setEditingRun(null);
    setSelectedRun(null);
    setEditText('');
    setSelectedDisplayItem(null);
    setDisplayItems([]);
  }, [doc, currentPage, setEditingRun]);

  // Sync text properties sidebar from selected text run
  useEffect(() => {
    if (selectedRun) {
      if (selectedRun.fontSize) setTextFontSize(Math.round(selectedRun.fontSize));
      if (selectedRun.fontName) setTextFontFamily(selectedRun.fontName);
      if (selectedRun.fillColor) {
        const [r, g, b] = selectedRun.fillColor;
        const hex = '#' + [r, g, b].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
        setTextColor(hex);
      }
    }
  }, [selectedRun]);

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

        // Extract display items (images, significant paths) for bounding box overlays
        try {
          const pageData = doc!.pages[currentPage];
          const cBytes = engine.getPageContentBytes(pageData, doc!.objects);
          const interpreted = engine.interpretPage(cBytes, pageData, doc!.objects);
          const visItems = interpreted.displayList.filter(
            (di: { type: string; width?: number; height?: number }) => {
              if (di.type === 'image') return true;
              if (di.type === 'path') {
                return (di.width || 0) > 20 && (di.height || 0) > 20;
              }
              return false;
            }
          );
          if (!cancelled) setDisplayItems(visItems as (ImageItem | PathItem)[]);
        } catch (dispErr) {
          console.warn('[Editor] Display items extraction failed:', dispErr);
          if (!cancelled) setDisplayItems([]);
        }

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

    // ── Display item bounding boxes (images/paths) in select mode ──
    if (activeTool === 'select' && displayItems.length > 0) {
      ctx.save();
      ctx.scale(dpr, dpr);

      for (const item of displayItems) {
        const isImage = item.type === 'image';
        const isSelected = selectedDisplayItem === item;

        const topLeft = pdfToCanvas(
          item.x, item.y + item.height,
          scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
        );
        const bottomRight = pdfToCanvas(
          item.x + item.width, item.y,
          scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
        );

        const boxX = topLeft.cssX;
        const boxY = topLeft.cssY;
        const boxW = bottomRight.cssX - topLeft.cssX;
        const boxH = bottomRight.cssY - topLeft.cssY;

        if (boxW < 3 || boxH < 3) continue;

        if (isSelected) {
          ctx.strokeStyle = isImage ? '#3b82f6' : '#22c55e';
          ctx.lineWidth = 2;
          ctx.setLineDash([]);
          ctx.fillStyle = isImage ? 'rgba(59,130,246,0.06)' : 'rgba(34,197,94,0.06)';
          ctx.fillRect(boxX, boxY, boxW, boxH);
          ctx.strokeRect(boxX, boxY, boxW, boxH);

          const hs = 7;
          ctx.fillStyle = isImage ? '#3b82f6' : '#22c55e';
          const corners: [number, number][] = [
            [boxX, boxY], [boxX + boxW, boxY],
            [boxX, boxY + boxH], [boxX + boxW, boxY + boxH],
          ];
          for (const [cx, cy] of corners) {
            ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
          }

          ctx.font = '600 11px Inter, system-ui, sans-serif';
          const label = isImage ? 'Image' : 'Drawing / Signature';
          const labelW = ctx.measureText(label).width;
          const badgePad = 6;
          const badgeH = 20;
          const badgeY2 = boxY - badgeH - 4;
          ctx.fillStyle = isImage ? '#3b82f6' : '#22c55e';
          ctx.beginPath();
          ctx.roundRect(boxX, badgeY2, labelW + badgePad * 2, badgeH, 4);
          ctx.fill();
          ctx.fillStyle = '#ffffff';
          ctx.fillText(label, boxX + badgePad, badgeY2 + 14);
        } else {
          ctx.strokeStyle = isImage ? 'rgba(59,130,246,0.4)' : 'rgba(34,197,94,0.3)';
          ctx.lineWidth = 1.5;
          ctx.setLineDash([5, 4]);
          ctx.strokeRect(boxX, boxY, boxW, boxH);
          ctx.setLineDash([]);
        }
      }

      ctx.restore();
    }

    // ── Freehand drawing paths ──
    if (drawnPaths.length > 0) {
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const path of drawnPaths) {
        if (path.points.length < 2) continue;
        
        ctx.beginPath();
        if (path.type === 'highlight') {
          ctx.globalCompositeOperation = 'multiply';
          ctx.globalAlpha = 0.4;
        } else {
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1.0;
        }
        
        ctx.strokeStyle = path.color;
        ctx.lineWidth = path.size;
        
        ctx.moveTo(path.points[0].x, path.points[0].y);
        for (let i = 1; i < path.points.length; i++) {
          ctx.lineTo(path.points[i].x, path.points[i].y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [editingRun, editText, caretPos, renderResult, doc, currentPage, scale, drawnPaths, activeTool, displayItems, selectedDisplayItem]);

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
        // Clicked on empty space — check display items or deselect
        if (activeTool === 'select') {
          const itemHit = hitTestDisplayItems(pdfX, pdfY, displayItems);
          if (itemHit) {
            if (editingRun) handleEditSubmit();
            setSelectedDisplayItem(itemHit);
            setSelectedRun(null);
            setEditingRun(null);
            return;
          }
        }
        setSelectedDisplayItem(null);
        if (editingRun) {
          handleEditSubmit();
        } else {
          setEditingRun(null);
          setSelectedRun(null);
        }
      }
    } else if (activeTool === 'addtext') {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
      
      // Inject new text run at click position
      try {
        setIsSaving(true);
        const engine = engineRef.current;
        if (!engine) return;
        const page = doc.pages[currentPage];
        const contentBytes = engine.getPageContentBytes(page, doc.objects);
        
        // Push undo snapshot
        undoStackRef.current.push({ pageIndex: currentPage, contentBytes: new Uint8Array(contentBytes) });
        if (undoStackRef.current.length > 50) undoStackRef.current.shift();
        redoStackRef.current = [];
        
        const newBytes = engine.insertTextRun(
          contentBytes, page, doc.objects,
          "New Text", pdfX, pdfY, textFontSize, hexToRGB(textColor)
        );
        
        engine.updatePageContent(page.contentRefs, newBytes, doc.objects).then(() => {
          setRenderKey(k => k + 1);
        });
      } catch (err) {
        console.error('[Editor] Add text failed:', err);
      } finally {
        setIsSaving(false);
        // Switch back to text edit tool so they can click it
        setActiveTool('text');
      }
    } else if (activeTool === 'highlight') {
      const hit = hitTestTextRuns(pdfX, pdfY, renderResult.textRuns);
      if (hit) setSelectedRun(hit);
    }
  }, [renderResult, doc, currentPage, scale, activeTool, editingRun, handleEditSubmit, setEditingRun, displayItems, textFontSize, textColor]);

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

  const applyEraser = useCallback((x: number, y: number) => {
    const eraserRadius = eraserSize / 2;
    setDrawnPaths(prev => {
      let newPaths: DrawnPath[] = [];
      let modified = false;
      for (const path of prev) {
        let currentSubPath: {x:number, y:number}[] = [];
        for (const p of path.points) {
          const dx = p.x - x;
          const dy = p.y - y;
          if (Math.sqrt(dx*dx + dy*dy) > eraserRadius) {
            currentSubPath.push(p);
          } else {
            if (currentSubPath.length > 0) {
              newPaths.push({ ...path, id: Math.random().toString(36).substr(2,9), points: currentSubPath });
              currentSubPath = [];
              modified = true;
            }
          }
        }
        if (currentSubPath.length > 0) {
          if (currentSubPath.length === path.points.length) {
            newPaths.push(path);
          } else {
            newPaths.push({ ...path, id: Math.random().toString(36).substr(2,9), points: currentSubPath });
            modified = true;
          }
        }
      }
      return modified ? newPaths : prev;
    });
  }, [eraserSize]);

  // ── Commit drawings to PDF ──
  const commitDrawingsToPdf = useCallback(() => {
    if (!doc || !engineRef.current || drawnPaths.length === 0) return;
    const engine = engineRef.current;
    const page = doc.pages[currentPage];
    let currentObjNum = engine.getNextObjNum(doc);
    
    const pageHeight = renderResult?.pageHeight || page.mediaBox.height;
    
    for (const p of drawnPaths) {
      if (p.points.length < 2) continue;
      
      const inkPathsPdf: number[][] = [[]];
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      
      for (const pt of p.points) {
        const { pdfX, pdfY } = canvasToPdf(
          pt.x, pt.y, scale, 
          renderResult?.pageWidth || page.mediaBox.width, 
          pageHeight, 
          page.mediaBox.x, page.mediaBox.y
        );
        inkPathsPdf[0].push(pdfX, pdfY);
        minX = Math.min(minX, pdfX);
        minY = Math.min(minY, pdfY);
        maxX = Math.max(maxX, pdfX);
        maxY = Math.max(maxY, pdfY);
      }
      
      const lw = p.size / scale;
      const rect = { x: minX - lw, y: minY - lw, width: (maxX - minX) + lw*2, height: (maxY - minY) + lw*2 };
      const rgb = hexToRGB(p.color);
      
      const annotation: import('@/engine').InkAnnotation = {
        type: 'Ink',
        rect,
        color: rgb,
        opacity: p.type === 'highlight' ? 0.4 : 1.0,
        inkPaths: inkPathsPdf,
        lineWidth: lw,
      };
      
      const { dict, appearanceStream } = engine.createAnnotationDict(annotation, currentObjNum++);
      if (appearanceStream) {
        doc.objects.set(`${currentObjNum}_0`, appearanceStream as import('@/engine').PDFObject);
        currentObjNum++;
      }
      
      const annotRef = new engine.PDFRef(currentObjNum, 0);
      engine.addAnnotationToPage(page.dict, dict, annotRef, doc.objects);
      currentObjNum++;
    }
    
    setDrawnPaths([]);
  }, [doc, currentPage, drawnPaths, scale, renderResult]);

  const handleDrawStart = useCallback((e: React.MouseEvent) => {
    if (activeTool !== 'draw' && activeTool !== 'highlight' && activeTool !== 'erase') return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    setIsDrawing(true);

    if (activeTool === 'erase') {
      applyEraser(x, y);
    } else {
      currentDrawPath.current = [{ x, y }];
    }
  }, [activeTool, applyEraser]);

  const handleDrawMove = useCallback((e: React.MouseEvent) => {
    if (!isDrawing) return;
    const overlay = overlayRef.current;
    if (!overlay) return;

    const rect = overlay.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (activeTool === 'erase') {
      applyEraser(x, y);
      return;
    }

    currentDrawPath.current.push({ x, y });

    // Live draw on overlay
    const ctx = overlay.getContext('2d');
    if (ctx) {
      const dpr = window.devicePixelRatio || 1;
      const path = currentDrawPath.current;
      if (path.length >= 2) {
        ctx.save();
        ctx.scale(dpr, dpr);
        if (activeTool === 'highlight') {
          ctx.strokeStyle = highlightColor;
          ctx.lineWidth = highlightSize;
          ctx.globalCompositeOperation = 'multiply';
          ctx.globalAlpha = 0.4;
        } else {
          ctx.strokeStyle = drawColor;
          ctx.lineWidth = drawSize;
          ctx.globalCompositeOperation = 'source-over';
          ctx.globalAlpha = 1.0;
        }
        ctx.lineCap = 'round';
        ctx.beginPath();
        const prev = path[path.length - 2];
        ctx.moveTo(prev.x, prev.y);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.restore();
      }
    }
  }, [isDrawing, activeTool, drawColor, drawSize, highlightColor, highlightSize, applyEraser]);

  const handleDrawEnd = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);
    
    if (activeTool === 'erase') return;

    if (currentDrawPath.current.length > 1) {
      const newPath: DrawnPath = {
        id: Math.random().toString(36).substr(2,9),
        type: activeTool as PathType,
        color: activeTool === 'draw' ? drawColor : highlightColor,
        size: activeTool === 'draw' ? drawSize : highlightSize,
        points: [...currentDrawPath.current]
      };
      
      // Immediately commit to PDF to use native annotation rendering
      setDrawnPaths([newPath]);
      setTimeout(() => {
        commitDrawingsToPdf();
        setRenderKey(k => k + 1);
      }, 0);
    }
    currentDrawPath.current = [];
  }, [isDrawing, activeTool, drawColor, drawSize, highlightColor, highlightSize, commitDrawingsToPdf]);

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
    commitDrawingsToPdf();
    setCurrentPage(p => Math.max(0, p - 1));
  }, [commitDrawingsToPdf]);

  const goToNext = useCallback(() => {
    commitDrawingsToPdf();
    setCurrentPage(p => Math.min(totalPages - 1, p + 1));
  }, [totalPages, commitDrawingsToPdf]);

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
      commitDrawingsToPdf();
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
      } else if (e.key === 'a' || e.key === 'A') {
        setActiveTool('addtext');
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
      <div className="min-h-screen flex flex-col items-center justify-center bg-zinc-950 text-zinc-400">
        <div className="w-8 h-8 border-4 border-zinc-800 border-t-blue-500 rounded-full animate-spin" />
        <p className="mt-4 text-sm font-medium animate-pulse">Processing PDF...</p>
      </div>
    );
  }

  // ── Error state ──
  if (error && !doc) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center font-sans bg-zinc-950 text-zinc-100">
        <p className="text-red-500 text-sm max-w-[400px] text-center leading-relaxed">
          {error}
        </p>
        <button 
          onClick={handleClose} 
          className="mt-6 px-4 py-2 rounded-lg border border-zinc-700 text-zinc-300 hover:bg-zinc-800 transition-colors flex items-center gap-2"
        >
          <ChevronLeft size={16} /> Go Back
        </button>
      </div>
    );
  }

  const eraserSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${eraserSize}" height="${eraserSize}" viewBox="0 0 ${eraserSize} ${eraserSize}"><circle cx="${eraserSize/2}" cy="${eraserSize/2}" r="${eraserSize/2 - 1}" fill="rgba(255,255,255,0.4)" stroke="black" stroke-width="1"/></svg>`;
  const eraserCursorUrl = `url('data:image/svg+xml;utf8,${encodeURIComponent(eraserSvg)}') ${eraserSize/2} ${eraserSize/2}, auto`;
  
  const cursorForTool = activeTool === 'text' ? 'text' 
    : activeTool === 'draw' ? 'crosshair' 
    : activeTool === 'highlight' ? 'pointer' 
    : activeTool === 'erase' ? eraserCursorUrl 
    : 'default';

  // ── Main editor UI ──
  return (
    <div className="flex flex-col h-screen font-sans bg-zinc-950 text-zinc-100 selection:bg-blue-500/30">
      
      {/* ── Top toolbar ── */}
      <header className="flex items-center justify-between px-4 h-14 bg-zinc-900/80 backdrop-blur-lg border-b border-zinc-800/80 shrink-0 z-20">
        <div className="flex items-center gap-3">
          <button 
            onClick={handleClose} 
            className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-md transition-all duration-200" 
            title="Close file"
          >
            <X size={18} />
          </button>
          <span className="text-zinc-300 font-medium text-sm truncate max-w-[250px]">{fileName}</span>
        </div>

        <div className="flex items-center gap-2 bg-zinc-900 px-2 py-1.5 rounded-lg border border-zinc-800 shadow-sm">
          <button onClick={goToPrev} disabled={currentPage === 0} className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors">
            <ChevronLeft size={18} />
          </button>
          <span className="text-zinc-400 text-xs font-medium w-16 text-center tracking-wider">
            {currentPage + 1} / {totalPages}
          </span>
          <button onClick={goToNext} disabled={currentPage >= totalPages - 1} className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors">
            <ChevronRight size={18} />
          </button>

          <div className="w-[1px] h-4 bg-zinc-800 mx-2" />

          <button onClick={zoomOut} disabled={scale <= 0.5} className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors">
            <ZoomOut size={16} />
          </button>
          <span className="text-zinc-400 text-xs font-medium w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button onClick={zoomIn} disabled={scale >= 4} className="p-1 text-zinc-400 hover:text-zinc-100 disabled:opacity-30 disabled:hover:text-zinc-400 transition-colors">
            <ZoomIn size={16} />
          </button>
        </div>

        <div className="flex items-center gap-3">
          {drawnPaths.length > 0 && (
            <button
              onClick={() => setDrawnPaths([])}
              className="text-xs font-medium px-3 py-1.5 text-red-400 bg-red-400/10 hover:bg-red-400/20 rounded-md transition-colors"
            >
              Clear
            </button>
          )}
          <button
            onClick={handleDownload}
            disabled={isSaving}
            className="flex items-center gap-2 text-xs font-semibold px-4 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-md shadow-sm transition-all disabled:opacity-50"
          >
            {isSaving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {isSaving ? 'Saving...' : 'Save PDF'}
          </button>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        
        {/* ── Left sidebar (Tools only) ── */}
        <aside className="w-16 bg-zinc-900/95 backdrop-blur-md border-r border-zinc-800/80 flex flex-col items-center pt-4 pb-4 gap-2 shrink-0 z-10 shadow-[4px_0_24px_rgba(0,0,0,0.2)]">
          <div className="flex-1 flex flex-col gap-2 w-full px-2">
            {TOOLS.map((tool) => {
              const isActive = activeTool === tool.id;
              const isHighlight = tool.id === 'highlight';
              const activeColor = isHighlight ? highlightColor : '#3b82f6';
              
              return (
                <button
                  key={tool.id}
                  onClick={() => setActiveTool(tool.id)}
                  title={`${tool.label} (${tool.shortcut})`}
                  className={`w-full aspect-square flex flex-col items-center justify-center gap-1 rounded-xl transition-all duration-200 group relative`}
                  style={{
                    backgroundColor: isActive ? (isHighlight ? `${highlightColor}25` : 'rgba(59, 130, 246, 0.15)') : 'transparent',
                    color: isActive ? activeColor : '#a1a1aa',
                  }}
                >
                  <div className={`transition-transform duration-200 ${isActive ? 'scale-110' : 'group-hover:scale-110 group-hover:text-zinc-300'}`}>
                    {tool.icon}
                  </div>
                  {isActive && (
                    <div 
                      className="absolute left-0 top-1/4 bottom-1/4 w-1 rounded-r-full"
                      style={{ backgroundColor: activeColor }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </aside>

        {/* ── Left Sidebar (Properties) ── */}
        {['text', 'addtext', 'draw', 'highlight', 'erase', 'select'].includes(activeTool) && (
          <div className="w-64 bg-zinc-900/95 backdrop-blur-md border-r border-zinc-800/80 flex flex-col shrink-0 z-10 overflow-y-auto shadow-[4px_0_24px_rgba(0,0,0,0.2)]">
            {/* TEXT TOOL PROPERTIES */}
            {(activeTool === 'text' || activeTool === 'addtext') && (
              <div className="p-4 space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
                <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
                  <Type size={14} />
                  Text Properties
                </div>

                {/* Selected run info */}
                {selectedRun && (
                  <div className="bg-zinc-800/60 rounded-lg p-2.5 text-[11px] text-zinc-400 border border-zinc-700/50">
                    <span className="text-zinc-200 font-medium">Editing:</span>{' '}
                    &quot;{selectedRun.text.substring(0, 40)}{selectedRun.text.length > 40 ? '…' : ''}&quot;
                  </div>
                )}

                {/* Font Family */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Font</label>
                  <select
                    value={textFontFamily}
                    onChange={(e) => setTextFontFamily(e.target.value)}
                    className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-200 outline-none focus:border-blue-500 transition-colors cursor-pointer appearance-none"
                  >
                    <option value="Helvetica">Helvetica</option>
                    <option value="Times-Roman">Times Roman</option>
                    <option value="Courier">Courier</option>
                    <option value="Arial">Arial</option>
                    <option value="Georgia">Georgia</option>
                    <option value="Verdana">Verdana</option>
                    <option value="Trebuchet MS">Trebuchet MS</option>
                    <option value="Palatino">Palatino</option>
                  </select>
                </div>

                {/* Font Size */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Size</label>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setTextFontSize(s => Math.max(4, s - 1))} 
                      className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-md text-zinc-400 transition-colors border border-zinc-700"
                    >
                      <Minus size={12} />
                    </button>
                    <input
                      type="number"
                      value={textFontSize}
                      onChange={(e) => setTextFontSize(Math.max(4, Math.min(200, parseInt(e.target.value) || 12)))}
                      className="w-16 bg-zinc-800 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 text-center outline-none focus:border-blue-500"
                    />
                    <button 
                      onClick={() => setTextFontSize(s => Math.min(200, s + 1))} 
                      className="p-1.5 bg-zinc-800 hover:bg-zinc-700 rounded-md text-zinc-400 transition-colors border border-zinc-700"
                    >
                      <Plus size={12} />
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {[8, 10, 12, 14, 16, 18, 24, 36, 48, 72].map(s => (
                      <button
                        key={s}
                        onClick={() => setTextFontSize(s)}
                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${textFontSize === s ? 'bg-blue-600 text-white shadow-sm' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border border-zinc-700/50'}`}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Style */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Style</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setTextBold(b => !b)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${textBold ? 'bg-blue-600/20 text-blue-400 border border-blue-500/50' : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'}`}
                    >
                      <Bold size={14} /> Bold
                    </button>
                    <button
                      onClick={() => setTextItalic(i => !i)}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold flex items-center justify-center gap-1.5 transition-all ${textItalic ? 'bg-blue-600/20 text-blue-400 border border-blue-500/50' : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'}`}
                    >
                      <Italic size={14} /> Italic
                    </button>
                  </div>
                </div>

                {/* Color */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Color</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={textColor}
                      onChange={(e) => setTextColor(e.target.value)}
                      className="w-8 h-8 rounded-lg border border-zinc-700 cursor-pointer bg-transparent"
                    />
                    <span className="text-[11px] text-zinc-400 font-mono">{textColor.toUpperCase()}</span>
                  </div>
                  <div className="flex gap-1.5 mt-1">
                    {['#000000', '#ffffff', '#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#6b7280'].map(c => (
                      <button
                        key={c}
                        onClick={() => setTextColor(c)}
                        className={`w-5 h-5 rounded-full border-2 transition-transform ${textColor.toLowerCase() === c ? 'scale-125 border-blue-400' : 'border-zinc-700 hover:scale-110'}`}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>

                {/* Alignment */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Alignment</label>
                  <div className="flex gap-1 bg-zinc-800 p-1 rounded-lg border border-zinc-700">
                    {([
                      { val: 'left' as const, icon: <AlignLeft size={14} /> },
                      { val: 'center' as const, icon: <AlignCenter size={14} /> },
                      { val: 'right' as const, icon: <AlignRight size={14} /> },
                    ]).map(a => (
                      <button
                        key={a.val}
                        onClick={() => setTextAlign(a.val)}
                        className={`flex-1 py-1.5 rounded-md flex items-center justify-center transition-all ${textAlign === a.val ? 'bg-blue-600 text-white shadow-sm' : 'text-zinc-400 hover:text-zinc-200'}`}
                      >
                        {a.icon}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Opacity */}
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Opacity</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="0" max="100"
                      value={textOpacity}
                      onChange={(e) => setTextOpacity(parseInt(e.target.value))}
                      className="flex-1 accent-blue-500"
                    />
                    <span className="text-[11px] text-zinc-400 w-8 text-right font-mono">{textOpacity}%</span>
                  </div>
                </div>
              </div>
            )}

            {/* DRAW TOOL PROPERTIES */}
            {activeTool === 'draw' && (
              <div className="p-4 space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
                <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
                  <PenTool size={14} />
                  Draw Properties
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Color</label>
                  <div className="grid grid-cols-4 gap-2 p-2 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
                    {['#ef4444', '#3b82f6', '#22c55e', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#f4f4f5'].map(color => (
                      <button
                        key={color}
                        onClick={() => setDrawColor(color)}
                        className={`w-6 h-6 rounded-full mx-auto transition-transform ${drawColor === color ? 'scale-125 ring-2 ring-zinc-300 ring-offset-2 ring-offset-zinc-900' : 'hover:scale-110'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Brush Size</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="1" max="20"
                      value={drawSize}
                      onChange={(e) => setDrawSize(parseInt(e.target.value))}
                      className="flex-1 accent-blue-500"
                    />
                    <span className="text-[11px] text-zinc-400 w-8 text-right font-mono">{drawSize}px</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[10px] text-zinc-500">Preview:</span>
                  <div 
                    className="rounded-full" 
                    style={{ width: drawSize + 4, height: drawSize + 4, backgroundColor: drawColor }}
                  />
                </div>
              </div>
            )}

            {/* HIGHLIGHT TOOL PROPERTIES */}
            {activeTool === 'highlight' && (
              <div className="p-4 space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
                <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
                  <Highlighter size={14} />
                  Highlight Properties
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Color</label>
                  <div className="grid grid-cols-4 gap-2 p-2 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
                    {['#fffb00', '#00ff00', '#00e5ff', '#ff00ff', '#ff8c00', '#ff6b6b', '#a78bfa', '#67e8f9'].map(color => (
                      <button
                        key={color}
                        onClick={() => setHighlightColor(color)}
                        className={`w-6 h-6 rounded-full mx-auto transition-transform ${highlightColor === color ? 'scale-125 ring-2 ring-zinc-300 ring-offset-2 ring-offset-zinc-900' : 'hover:scale-110'}`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Thickness</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="5" max="40"
                      value={highlightSize}
                      onChange={(e) => setHighlightSize(parseInt(e.target.value))}
                      className="flex-1 accent-yellow-400"
                    />
                    <span className="text-[11px] text-zinc-400 w-8 text-right font-mono">{highlightSize}px</span>
                  </div>
                </div>
              </div>
            )}

            {/* ERASER PROPERTIES */}
            {activeTool === 'erase' && (
              <div className="p-4 space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
                <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
                  <Eraser size={14} />
                  Eraser Properties
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Eraser Size</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="range"
                      min="5" max="50"
                      value={eraserSize}
                      onChange={(e) => setEraserSize(parseInt(e.target.value))}
                      className="flex-1 accent-zinc-400"
                    />
                    <span className="text-[11px] text-zinc-400 w-8 text-right font-mono">{eraserSize}px</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 pt-1">
                  <span className="text-[10px] text-zinc-500">Preview:</span>
                  <div 
                    className="rounded-full border-2 border-zinc-500" 
                    style={{ width: eraserSize, height: eraserSize, backgroundColor: 'rgba(255,255,255,0.15)' }}
                  />
                </div>
              </div>
            )}

            {/* SELECT TOOL — SELECTED IMAGE/SIGNATURE INFO */}
            {activeTool === 'select' && selectedDisplayItem && (
              <div className="p-4 space-y-4 animate-in fade-in slide-in-from-left-4 duration-300">
                <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
                  {selectedDisplayItem.type === 'image' ? <Image size={14} /> : <PenTool size={14} />}
                  {selectedDisplayItem.type === 'image' ? 'Image Properties' : 'Drawing / Signature'}
                </div>
                <div className="space-y-2 text-[11px]">
                  <div className="flex justify-between bg-zinc-800/50 rounded-md px-3 py-2 border border-zinc-700/50">
                    <span className="text-zinc-500">Type</span>
                    <span className="text-zinc-200 font-medium capitalize">{selectedDisplayItem.type}</span>
                  </div>
                  <div className="flex justify-between bg-zinc-800/50 rounded-md px-3 py-2 border border-zinc-700/50">
                    <span className="text-zinc-500">Position</span>
                    <span className="text-zinc-200 font-mono">{Math.round(selectedDisplayItem.x)}, {Math.round(selectedDisplayItem.y)}</span>
                  </div>
                  <div className="flex justify-between bg-zinc-800/50 rounded-md px-3 py-2 border border-zinc-700/50">
                    <span className="text-zinc-500">Size</span>
                    <span className="text-zinc-200 font-mono">{Math.round(selectedDisplayItem.width)} × {Math.round(selectedDisplayItem.height)} pt</span>
                  </div>
                </div>
                <div className="space-y-2 pt-2">
                  <button 
                    onClick={() => setSelectedDisplayItem(null)}
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium bg-zinc-800 text-zinc-300 border border-zinc-700 hover:bg-zinc-700 transition-colors"
                  >
                    <X size={12} /> Deselect
                  </button>
                  <button 
                    className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors"
                  >
                    <Trash2 size={12} /> Delete
                  </button>
                </div>
              </div>
            )}

            {/* SELECT TOOL — NO SELECTION */}
            {activeTool === 'select' && !selectedDisplayItem && (
              <div className="p-4 space-y-3 animate-in fade-in slide-in-from-left-4 duration-300">
                <div className="flex items-center gap-2 text-[10px] font-bold tracking-widest text-zinc-400 uppercase">
                  <MousePointer2 size={14} />
                  Select Tool
                </div>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  Click on images or drawings to select them. Double-click text to edit.
                </p>
                {displayItems.length > 0 && (
                  <div className="bg-zinc-800/50 rounded-lg p-2.5 border border-zinc-700/50">
                    <span className="text-[10px] font-bold tracking-widest text-zinc-500 uppercase">Detected</span>
                    <div className="flex gap-3 mt-2">
                      <span className="text-[11px] text-blue-400">
                        {displayItems.filter(d => d.type === 'image').length} images
                      </span>
                      <span className="text-[11px] text-green-400">
                        {displayItems.filter(d => d.type === 'path').length} drawings
                      </span>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Canvas area ── */}
        <div className="flex-1 overflow-auto relative flex justify-center items-start py-12 checkerboard">
          {isRendering && (
            <div className="absolute top-4 right-4 z-30 bg-zinc-900/90 backdrop-blur border border-zinc-800 shadow-lg rounded-full px-4 py-2 flex items-center gap-2 text-zinc-300 text-sm font-medium animate-in slide-in-from-top-4 fade-in">
              <Loader2 size={16} className="animate-spin text-blue-500" />
              Rendering...
            </div>
          )}

          <div
            ref={canvasContainerRef}
            className="relative inline-block shrink-0 shadow-2xl transition-transform duration-200"
            style={{ cursor: cursorForTool }}
            onClick={handleCanvasClick}
            onDoubleClick={handleCanvasDoubleClick}
            onMouseDown={handleDrawStart}
            onMouseMove={handleDrawMove}
            onMouseUp={handleDrawEnd}
            onMouseLeave={handleDrawEnd}
          >
            {/* PDF canvas is prepended here by the render effect */}

            {/* Overlay canvas for caret / drawings */}
            <canvas
              ref={overlayRef}
              className="absolute top-0 left-0 z-10"
              style={{
                pointerEvents: ['draw', 'highlight', 'erase'].includes(activeTool) ? 'auto' : 'none',
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
              className="fixed left-0 top-0 w-px h-px opacity-0 pointer-events-none p-0 border-none outline-none resize-none overflow-hidden -z-10"
            />
          </div>
        </div>

        {/* ── Right Sidebar: Page Thumbnails ── */}
        <div className="w-56 bg-zinc-900/95 backdrop-blur-md border-l border-zinc-800/80 flex flex-col shrink-0 z-10 overflow-y-auto p-3 gap-3 shadow-[-4px_0_24px_rgba(0,0,0,0.2)]">
          {/* ── Page Thumbnails ── */}
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
                  onClick={() => {
                    commitDrawingsToPdf();
                    setCurrentPage(i);
                  }}
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
      </div>

      {/* ── Bottom status bar ── */}
      <footer className="flex items-center justify-between px-4 h-7 bg-zinc-900 border-t border-zinc-800 shrink-0 select-none">
        <span className="text-[10px] font-medium tracking-wider text-zinc-500">
          {renderResult
            ? `${renderResult.pageWidth.toFixed(0)} × ${renderResult.pageHeight.toFixed(0)} PT`
            : ''}
        </span>
        <span className="text-[10px] font-medium tracking-wider text-zinc-500 flex items-center gap-2">
          <span>TOOL: <span className="text-zinc-300">{TOOLS.find(t => t.id === activeTool)?.label.toUpperCase()}</span></span>
          {selectedRun && (
            <>
              <span className="w-1 h-1 rounded-full bg-zinc-700" />
              <span>SELECTED: <span className="text-zinc-300">&quot;{selectedRun.text.substring(0, 30)}{selectedRun.text.length > 30 ? '…' : ''}&quot;</span></span>
            </>
          )}
        </span>
        <span className="text-[10px] font-medium tracking-wider text-zinc-500">
          {renderResult ? `${renderResult.textRuns.length} RUNS` : ''}
          {doc ? ` • ${totalPages} PAGES • v${doc.version}` : ''}
        </span>
      </footer>

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-red-500/10 backdrop-blur-md border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-4 shadow-xl z-[100] animate-in slide-in-from-bottom-5 fade-in">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 transition-colors">
            <X size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
