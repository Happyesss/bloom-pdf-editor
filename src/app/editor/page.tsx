'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { loadPdfFromStorage, clearPdfFromStorage } from '@/lib/pdfStorage';
import { X, Loader2, ChevronLeft, Image, Type } from 'lucide-react';

// We import types only — the engine modules are loaded dynamically
// because they require browser APIs (canvas, DecompressionStream)
import type { PDFDocumentData, RenderResult, TextRun, TextLine, ImageItem, PathItem, DisplayItem, TextWatermark, ImageWatermark, Watermark, DetectedWatermark, AcroFormWidget, BloomPage } from '@/engine';

import type { EditorTool, ToolDef, PathType, DrawnPath, FloatingText, FloatingImage } from './types';
import { TOOLS } from './types';
import {
  canvasToPdf, pdfToCanvas, hexToRGB,
  hitTestTextLine, findNearestTextLine, caretIndexFromLineX,
  getLineBounds, getOverlayFontFamily,
} from './utils';
import { buildDisplayListIndex, hitTestDisplayList, TransactionStack } from '@/engine';
import type { QuadTree, SelectableItem } from '@/engine';
import { findMatchingFlowLine } from './flowLineMatch';

import { Toolbar } from './components/Toolbar';
import { ToolsSidebar } from './components/ToolsSidebar';
import { PropertiesSidebar } from './components/PropertiesSidebar';

import { WatermarkPreview } from './components/WatermarkPreview';
import { ThumbnailsSidebar } from './components/ThumbnailsSidebar';
import { FindReplacePanel } from './components/FindReplacePanel';
import { StatusBar } from './components/StatusBar';
import { useTextStyleActions } from './hooks/useTextStyleActions';


// ─── Component ──────────────────────────────────────────────────────────────

export default function EditorPage() {
  const router = useRouter();

  // ── Core state ──
  const [doc, setDoc] = useState<PDFDocumentData | null>(null);
  const [fileName, setFileName] = useState('');
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [scale, setScale] = useState(1.0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRendering, setIsRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renderResult, setRenderResult] = useState<RenderResult | null>(null);
  const [thumbnails, setThumbnails] = useState<string[]>([]);
  const [isGeneratingThumbnails, setIsGeneratingThumbnails] = useState(false);

  // ── Phase 4 state ──
  const [activeTool, setActiveTool] = useState<EditorTool>('text');
  const [selectedLine, setSelectedLine] = useState<TextLine | null>(null);
  const [editingLineState, setEditingLineState] = useState<TextLine | null>(null);
  const editingLineRef = useRef<TextLine | null>(null);
  const editingLine = editingLineState;
  const setEditingLine = useCallback((line: TextLine | null | ((prev: TextLine | null) => TextLine | null)) => {
    if (typeof line === 'function') {
      setEditingLineState((prev: TextLine | null) => {
        const next = line(prev);
        editingLineRef.current = next;
        return next;
      });
    } else {
      editingLineRef.current = line;
      setEditingLineState(line);
    }
  }, []);
  const initialRunTextRef = useRef<string>('');
  const editAnchorLineRef = useRef<TextLine | null>(null);
  const [editText, setEditText] = useState('');
  const [caretPos, setCaretPos] = useState(0); // character index for caret
  const [isSaving, setIsSaving] = useState(false);
  const [renderKey, setRenderKey] = useState(0);

  // Bloom Engine — Word-like page model (source of truth for text editing)
  const [bloomPage, setBloomPage] = useState<BloomPage | null>(null);
  const bloomPageRef = useRef<BloomPage | null>(null);
  const editingBlockIdRef = useRef<string | null>(null);
  const setBloomPageBoth = useCallback((page: BloomPage | null) => {
    bloomPageRef.current = page;
    setBloomPage(page);
  }, []);

  // Drawing state
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawnPaths, setDrawnPaths] = useState<DrawnPath[]>([]);
  const currentDrawPath = useRef<{ x: number; y: number }[]>([]);

  const [floatingTexts, setFloatingTexts] = useState<FloatingText[]>([]);
  const [activeFloatingTextId, setActiveFloatingTextId] = useState<string | null>(null);

  const [floatingImages, setFloatingImages] = useState<FloatingImage[]>([]);
  const [activeFloatingImageId, setActiveFloatingImageId] = useState<string | null>(null);
  const replacingImageIdRef = useRef<string | null>(null);

  const dragInfo = useRef<{ id: string; type: 'text' | 'image'; startX: number; startY: number; startPdfX: number; startPdfY: number } | null>(null);

  // Tool properties
  const [drawColor, setDrawColor] = useState('#ff3b30');
  const [drawSize, setDrawSize] = useState(2);
  const [highlightColor, setHighlightColor] = useState('#fffb00');
  const [highlightSize, setHighlightSize] = useState(16);
  const [eraserSize, setEraserSize] = useState(20);

  // Watermark tool properties
  const [watermarkType, setWatermarkType] = useState<'text' | 'image' | 'shape'>('text');
  const [watermarkShapeType, setWatermarkShapeType] = useState<'rectangle' | 'circle' | 'pill'>('circle');
  const [watermarkShapeColor, setWatermarkShapeColor] = useState('#000000');
  const [watermarkText, setWatermarkText] = useState('Bloom PDF');
  const [watermarkFontName, setWatermarkFontName] = useState('Arial');
  const [watermarkOpacity, setWatermarkOpacity] = useState(50);
  const [watermarkRotation, setWatermarkRotation] = useState(45);
  const [watermarkSize, setWatermarkSize] = useState(50);
  const [watermarkPosition, setWatermarkPosition] = useState('center');
  const [watermarkMosaic, setWatermarkMosaic] = useState(false);
  const [watermarkLivePreview, setWatermarkLivePreview] = useState(true);
  const [showApplySuccessModal, setShowApplySuccessModal] = useState(false);
  const [watermarkPageFrom, setWatermarkPageFrom] = useState(1);
  const [watermarkPageTo, setWatermarkPageTo] = useState(1);
  const [watermarkLayer, setWatermarkLayer] = useState<'above' | 'below'>('above');
  const [watermarkColor, setWatermarkColor] = useState('#000000');
  const [watermarkImageFile, setWatermarkImageFile] = useState<File | null>(null);
  const [watermarkImageBytes, setWatermarkImageBytes] = useState<Uint8Array | null>(null);
  const [watermarkImageDims, setWatermarkImageDims] = useState<{ width: number; height: number } | null>(null);
  const [watermarkBlendMode, setWatermarkBlendMode] = useState('Normal');
  
  const [detectedWatermarks, setDetectedWatermarks] = useState<DetectedWatermark[] | null>(null);
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false);

  // Display items (images/paths) for selection overlays
  const [displayItems, setDisplayItems] = useState<(ImageItem | PathItem)[]>([]);
  const [selectedDisplayItem, setSelectedDisplayItem] = useState<ImageItem | PathItem | null>(null);
  const spatialIndexRef = useRef<QuadTree<SelectableItem> | null>(null);

  // AcroForm fields on current page
  const [formFields, setFormFields] = useState<AcroFormWidget[]>([]);
  const [selectedFormField, setSelectedFormField] = useState<AcroFormWidget | null>(null);
  const [formFieldDraft, setFormFieldDraft] = useState('');

  // Undo/redo via TransactionStack
  const txStackRef = useRef(new TransactionStack());
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const undoSnapshotRef = useRef<{ pageIndex: number; contentBytes: Uint8Array } | null>(null);

  const syncTxState = useCallback(() => {
    setCanUndo(txStackRef.current.canUndo());
    setCanRedo(txStackRef.current.canRedo());
  }, []);
  const [textFontFamily, setTextFontFamily] = useState('Helvetica');
  const [textFontSize, setTextFontSize] = useState(12);
  const [textColor, setTextColor] = useState('#000000');
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);
  const [textUnderline, setTextUnderline] = useState(false);
  const [textAlign, setTextAlign] = useState<'left' | 'center' | 'right'>('left');
  const [textOpacity, setTextOpacity] = useState(100);
  const [saveMode, setSaveMode] = useState<'quick' | 'optimized'>('optimized');
  const [isDirty, setIsDirty] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // ── Refs (declared early for hooks that need them) ──
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const hiddenInputRef = useRef<HTMLTextAreaElement>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const engineRef = useRef<typeof import('@/engine') | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pdfCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const bumpRender = useCallback(() => {
    setIsDirty(true);
    setRenderKey(k => k + 1);
  }, []);

  const { applyStyle } = useTextStyleActions(
    engineRef,
    doc,
    currentPage,
    selectedLine,
    bumpRender,
  );

  // Apply style changes from properties sidebar to the PDF
  const handleTextBold = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setTextBold(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      if (selectedLine && !editingLineRef.current) void applyStyle({ bold: next });
      return next;
    });
  }, [applyStyle, selectedLine]);
  const handleTextItalic = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setTextItalic(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      if (selectedLine && !editingLineRef.current) void applyStyle({ italic: next });
      return next;
    });
  }, [applyStyle, selectedLine]);
  const handleTextUnderline = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setTextUnderline(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      if (selectedLine && !editingLineRef.current) void applyStyle({ underline: next });
      return next;
    });
  }, [applyStyle, selectedLine]);
  const handleTextFontSize = useCallback((v: number | ((prev: number) => number)) => {
    setTextFontSize(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      if (selectedLine && !editingLineRef.current) void applyStyle({ fontSize: next });
      return next;
    });
  }, [applyStyle, selectedLine]);
  const handleTextColor = useCallback((v: string) => {
    setTextColor(v);
    if (selectedLine && !editingLineRef.current) void applyStyle({ color: v });
  }, [applyStyle, selectedLine]);
  const handleTextAlign = useCallback((v: 'left' | 'center' | 'right') => {
    setTextAlign(v);
    if (selectedLine && !editingLineRef.current) void applyStyle({ align: v });
  }, [applyStyle, selectedLine]);

  // Warn before leaving with unsaved edits
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [isDirty]);

  // Caret blinking
  const caretVisibleRef = useRef(true);
  const caretTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
        txStackRef.current.clear();
        const page0 = parsed.pages[0];
        const initialBytes = engine.getPageContentBytes(page0, parsed.objects);
        txStackRef.current.push({
          pageIndex: 0,
          contentBytes: new Uint8Array(initialBytes),
          label: 'initial',
          timestamp: Date.now(),
        });
        syncTxState();
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
    setEditingLine(null);
    setSelectedLine(null);
    setEditText('');
    setSelectedDisplayItem(null);
    setDisplayItems([]);
    spatialIndexRef.current = null;
  }, [doc, currentPage, setEditingLine]);

  // Sync text properties sidebar from selected line (use first run's style)
  useEffect(() => {
    if (selectedLine && selectedLine.runs.length > 0) {
      const run = selectedLine.runs[0];
      if (run.fontSize) setTextFontSize(Math.round(run.fontSize));
      if (run.fontName) setTextFontFamily(run.fontName);
      if (run.fillColor) {
        const [r, g, b] = run.fillColor;
        const hex = '#' + [r, g, b].map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
        setTextColor(hex);
      }
    }
  }, [selectedLine]);

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
          if (!cancelled) {
            const pageBounds = {
              x: pageData.mediaBox.x,
              y: pageData.mediaBox.y,
              width: pageData.mediaBox.width,
              height: pageData.mediaBox.height,
            };
            spatialIndexRef.current = buildDisplayListIndex(
              visItems as DisplayItem[],
              pageBounds,
            );
          }

          // Bloom ingest — skip re-ingest while mid-edit with dirty in-memory page
          if (!cancelled && !(editingBlockIdRef.current && bloomPageRef.current?.dirty)) {
            const flow = result.documentFlow ?? engine.buildDocumentFlow(interpreted.textRuns);
            const ingested = engine.ingestPage(interpreted.textRuns, {
              pageIndex: currentPage,
              width: pageData.mediaBox.width,
              height: pageData.mediaBox.height,
              flow,
              displayList: interpreted.displayList,
            });
            setBloomPageBoth(ingested);
          }
        } catch (dispErr) {
          console.warn('[Editor] Display items extraction failed:', dispErr);
          if (!cancelled) setDisplayItems([]);
          if (!cancelled) spatialIndexRef.current = null;
        }

        try {
          const fields = engine.detectFormFieldsOnPage(doc!, currentPage);
          if (!cancelled) {
            setFormFields(fields);
            if (selectedFormField) {
              const still = fields.find(f => f.ref.toKey() === selectedFormField.ref.toKey());
              setSelectedFormField(still ?? null);
              setFormFieldDraft(still && typeof still.value === 'string' ? still.value : '');
            }
          }
        } catch {
          if (!cancelled) setFormFields([]);
        }

        // Re-sync editing line only when not in overlay preview mode
        if (editingLineRef.current && !editAnchorLineRef.current) {
          const oldLine = editingLineRef.current;
          const newLine = result.textLines.find((l: TextLine) =>
            l.id === oldLine.id ||
            (Math.abs(l.baseline - oldLine.baseline) < 5 && Math.abs(l.x - oldLine.x) < 30)
          );
          if (newLine) {
            setEditingLine(newLine);
            setSelectedLine(newLine);
          } else {
            setEditingLine(null);
            setSelectedLine(null);
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

    // ── Edit: white-out only the active line (HTML input shows typed text) ──
    if (editingLine && editAnchorLineRef.current) {
      const anchor = editAnchorLineRef.current;
      const bounds = getLineBounds(anchor);
      const fontSize = anchor.fontSize;
      const pad = Math.max(2, fontSize * 0.2);

      ctx.save();
      ctx.scale(dpr, dpr);

      const maskTopLeft = pdfToCanvas(
        bounds.x - pad,
        bounds.y + bounds.height + pad,
        scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
      );
      const maskBottomRight = pdfToCanvas(
        Math.max(bounds.x + bounds.width, bounds.x + editText.length * fontSize * 0.5) + pad,
        bounds.y - pad,
        scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
      );
      const rx = Math.min(maskTopLeft.cssX, maskBottomRight.cssX);
      const ry = Math.min(maskTopLeft.cssY, maskBottomRight.cssY);
      const rw = Math.abs(maskBottomRight.cssX - maskTopLeft.cssX);
      const rh = Math.abs(maskBottomRight.cssY - maskTopLeft.cssY);
      
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(rx, ry, rw, rh);

      // Add a dotted blue border to indicate the selected block
      ctx.strokeStyle = '#3b82f6';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([4, 4]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);

      ctx.restore();
    }

    // ── Display item bounding boxes — hide while typing so blue handles don't appear on words ──
    if ((activeTool === 'select' || activeTool === 'text') && displayItems.length > 0 && !editingLine) {
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

    // ── AcroForm field overlays ──
    if (formFields.length > 0 && renderResult) {
      ctx.save();
      ctx.scale(dpr, dpr);
      for (const field of formFields) {
        const r = field.rect;
        if (!r) continue;
        const topLeft = pdfToCanvas(
          r.x, r.y + r.height,
          scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
        );
        const bottomRight = pdfToCanvas(
          r.x + r.width, r.y,
          scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
        );
        const boxX = topLeft.cssX;
        const boxY = topLeft.cssY;
        const boxW = bottomRight.cssX - topLeft.cssX;
        const boxH = bottomRight.cssY - topLeft.cssY;
        const selected = selectedFormField?.ref.toKey() === field.ref.toKey();
        ctx.strokeStyle = selected ? '#f59e0b' : 'rgba(245,158,11,0.45)';
        ctx.lineWidth = selected ? 2 : 1;
        ctx.setLineDash(selected ? [] : [4, 3]);
        ctx.fillStyle = selected ? 'rgba(245,158,11,0.12)' : 'rgba(245,158,11,0.04)';
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeRect(boxX, boxY, boxW, boxH);
        ctx.setLineDash([]);
        if (selected || boxH > 14) {
          ctx.font = '600 10px Inter, system-ui, sans-serif';
          ctx.fillStyle = '#f59e0b';
          const label = field.fieldName || field.fieldType;
          ctx.fillText(label, boxX + 3, boxY + 11);
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
  }, [editingLine, editText, caretPos, renderResult, doc, currentPage, scale, drawnPaths, activeTool, displayItems, selectedDisplayItem, formFields, selectedFormField]);

  // Re-draw overlay whenever edit state changes
  useEffect(() => { drawOverlay(); }, [drawOverlay]);

  // ── Caret blink timer ──
  useEffect(() => {
    if (editingLine) {
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
  }, [editingLine, drawOverlay]);

  // ── Focus hidden input when entering edit mode ──
  useEffect(() => {
    if (editingLine && hiddenInputRef.current) {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
      hiddenInputRef.current.focus({ preventScroll: true });
      const pos = caretPos;
      hiddenInputRef.current.setSelectionRange(pos, pos);
    }
  }, [editingLine, caretPos]);

  // ── Begin an edit session with frozen line anchor + undo snapshot ──
  const beginEditSession = useCallback((line: TextLine, caretAt?: number) => {
    initialRunTextRef.current = line.text;
    editAnchorLineRef.current = {
      ...line,
      runs: line.runs.map(r => ({
        ...r,
        glyphs: r.glyphs.map(g => ({ ...g, tRm: { ...g.tRm } })),
        sourceInstructionIndices: r.sourceInstructionIndices
          ? [...r.sourceInstructionIndices]
          : undefined,
      })),
      segments: line.segments.map(s => ({ ...s, run: s.run })),
    };
    editingBlockIdRef.current = line.id;
    setSelectedDisplayItem(null);
    setActiveTool('text');
    setSelectedLine(line);
    setEditingLine(line);
    setEditText(line.text);
    setCaretPos(caretAt ?? line.text.length);

    if (doc && engineRef.current) {
      const page = doc.pages[currentPage];
      const contentBytes = engineRef.current.getPageContentBytes(page, doc.objects);
      undoSnapshotRef.current = {
        pageIndex: currentPage,
        contentBytes: new Uint8Array(contentBytes),
      };
    }
  }, [doc, currentPage, setEditingLine]);

  // ── Text edit submit — surgical in-place line edit (preserve positions) ──
  const handleEditSubmit = useCallback(async (closeEdit: boolean = true) => {
    if (!editingLine || !doc || !engineRef.current) return;
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }

    const textChanged = editText !== initialRunTextRef.current;
    if (!textChanged) {
      editAnchorLineRef.current = null;
      undoSnapshotRef.current = null;
      editingBlockIdRef.current = null;
      if (closeEdit) {
        setEditingLine(null);
        setSelectedLine(null);
      }
      return;
    }

    try {
      setIsSaving(true);
      const engine = engineRef.current;
      const page = doc.pages[currentPage];
      const targetLine = editAnchorLineRef.current ?? editingLine;
      const snapshot = undoSnapshotRef.current;
      const baseBytes = snapshot?.pageIndex === currentPage
        ? snapshot.contentBytes
        : engine.getPageContentBytes(page, doc.objects);

      const editResult = engine.applyLineTextEdit(
        baseBytes,
        page,
        doc.objects,
        targetLine,
        editText,
        renderResult?.documentFlow,
      );

      if (editResult.needsFontAugmentation) {
        try {
          const missing = String.fromCharCode(
            ...editResult.missingCharCodes.filter(c => c < 0x10000),
          );
          engine.augmentFontsForMissingGlyphs(doc, currentPage, missing);
        } catch (augErr) {
          console.warn('[Editor] Font augmentation failed:', augErr);
        }
      }

      await engine.updatePageContent(
        page.contentRefs,
        editResult.newContentBytes,
        doc.objects,
      );
      txStackRef.current.push({
        pageIndex: currentPage,
        contentBytes: new Uint8Array(editResult.newContentBytes),
        label: 'text-edit',
        timestamp: Date.now(),
      });
      syncTxState();
      editAnchorLineRef.current = null;
      undoSnapshotRef.current = null;
      editingBlockIdRef.current = null;
      setIsDirty(true);
      if (closeEdit) {
        setEditingLine(null);
        setSelectedLine(null);
      }
      setRenderKey(k => k + 1);
    } catch (e) {
      console.error('[Editor] Edit failed:', e);
      setError(`Edit failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [editingLine, editText, doc, currentPage, setEditingLine, renderResult, syncTxState]);

  // ── Edit cancel — discard overlay only; PDF untouched until commit ──
  const handleEditCancel = useCallback(async () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
      blurTimeoutRef.current = null;
    }
    editAnchorLineRef.current = null;
    undoSnapshotRef.current = null;
    editingBlockIdRef.current = null;
    setEditingLine(null);
    setSelectedLine(null);
    setEditText('');
    setCaretPos(0);
  }, [setEditingLine]);

  // ── Undo ──
  const handleUndo = useCallback(async () => {
    if (!doc || !engineRef.current) return;
    const entry = txStackRef.current.undo();
    if (!entry) return;
    try {
      const engine = engineRef.current;
      const page = doc.pages[entry.pageIndex];
      await engine.updatePageContent(page.contentRefs, entry.contentBytes, doc.objects);
      undoSnapshotRef.current = null;
      setEditingLine(null);
      setSelectedLine(null);
      setEditText('');
      setCaretPos(0);
      if (entry.pageIndex !== currentPage) setCurrentPage(entry.pageIndex);
      syncTxState();
      setRenderKey(k => k + 1);
    } catch (e) {
      console.error('[Editor] Undo failed:', e);
    }
  }, [doc, currentPage, setEditingLine, syncTxState]);

  const handleRedo = useCallback(async () => {
    if (!doc || !engineRef.current) return;
    const entry = txStackRef.current.redo();
    if (!entry) return;
    try {
      const engine = engineRef.current;
      const page = doc.pages[entry.pageIndex];
      await engine.updatePageContent(page.contentRefs, entry.contentBytes, doc.objects);
      undoSnapshotRef.current = null;
      setEditingLine(null);
      setSelectedLine(null);
      setEditText('');
      setCaretPos(0);
      if (entry.pageIndex !== currentPage) setCurrentPage(entry.pageIndex);
      syncTxState();
      setRenderKey(k => k + 1);
    } catch (e) {
      console.error('[Editor] Redo failed:', e);
    }
  }, [doc, currentPage, setEditingLine, syncTxState]);

  const handleFormFieldSelect = useCallback((field: AcroFormWidget) => {
    setSelectedFormField(field);
    setFormFieldDraft(typeof field.value === 'string' ? field.value : '');
    setActiveTool('select');
  }, []);

  const handleFormFieldChange = useCallback((value: string) => {
    setFormFieldDraft(value);
    if (!doc || !selectedFormField || !engineRef.current) return;
    const engine = engineRef.current;
    if (selectedFormField.fieldType === 'Btn') {
      const checked = value === 'true' || value === 'Yes' || value === 'On';
      engine.setButtonFieldValue(doc, selectedFormField, checked);
      setFormFields(prev => prev.map(f =>
        f.ref.toKey() === selectedFormField.ref.toKey() ? { ...f, value: checked } : f,
      ));
    } else if (selectedFormField.fieldType === 'Ch') {
      engine.setChoiceFieldValue(doc, selectedFormField, value);
      setFormFields(prev => prev.map(f =>
        f.ref.toKey() === selectedFormField.ref.toKey() ? { ...f, value } : f,
      ));
    } else {
      engine.setFormFieldValue(doc, selectedFormField, value);
      setFormFields(prev => prev.map(f =>
        f.ref.toKey() === selectedFormField.ref.toKey() ? { ...f, value } : f,
      ));
    }
    setIsDirty(true);
  }, [doc, selectedFormField]);

  const handleFindReplace = useCallback(async (find: string, replace: string) => {
    if (!doc || !engineRef.current) return 0;
    const engine = engineRef.current;
    const page = doc.pages[currentPage];
    const bytes = engine.getPageContentBytes(page, doc.objects);
    const result = engine.findAndReplace(bytes, page, doc.objects, find, replace);
    await engine.updatePageContent(page.contentRefs, result.newContentBytes, doc.objects);
    setIsDirty(true);
    setRenderKey(k => k + 1);
    return result.missingCharCodes ? 1 : 1; // at least signal work done
  }, [doc, currentPage]);

  const handleRecognizeText = useCallback(async () => {
    if (!doc || !engineRef.current || !pdfCanvasRef.current) return;
    try {
      setIsSaving(true);
      setError(null);
      const { createDefaultOcrAdapter, canvasToImageData, mapOcrWordsToPdf } = await import('@/lib/ocr/adapter');
      const adapter = createDefaultOcrAdapter();
      const canvas = pdfCanvasRef.current;
      const imageData = canvasToImageData(canvas);
      const words = await adapter.recognize(imageData);
      const page = doc.pages[currentPage];
      const dpr = window.devicePixelRatio || 1;
      const mapped = mapOcrWordsToPdf(words, page.mediaBox.height, scale, page.mediaBox.y, dpr);
      if (mapped.length > 0) {
        await engineRef.current.insertInvisibleTextLayer(doc, currentPage, mapped);
        setIsDirty(true);
        setRenderKey(k => k + 1);
        setError(null);
        // Brief success via status — reuse error toast style as info
        console.log(`[OCR] Inserted ${mapped.length} words as invisible text`);
      } else {
        setError('OCR found no text on this page. Try a clearer scan or higher zoom.');
      }
    } catch (e) {
      setError(`OCR failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [doc, currentPage, scale]);

  const handleFlattenForms = useCallback(async () => {
    if (!doc || !engineRef.current || formFields.length === 0) return;
    try {
      setIsSaving(true);
      const engine = engineRef.current;
      const page = doc.pages[currentPage];
      await engine.flattenFormFieldsOnPage(doc, currentPage, formFields);
      const afterBytes = engine.getPageContentBytes(page, doc.objects);
      txStackRef.current.push({
        pageIndex: currentPage,
        contentBytes: new Uint8Array(afterBytes),
        label: 'flatten-forms',
        timestamp: Date.now(),
      });
      syncTxState();
      setFormFields([]);
      setSelectedFormField(null);
      setFormFieldDraft('');
      setRenderKey(k => k + 1);
    } catch (e) {
      console.error('[Editor] Flatten forms failed:', e);
      setError(`Flatten failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [doc, currentPage, formFields, syncTxState]);

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

      // Prefer real flow lines (sourceInstructionIndices) — never edit synthetic Bloom lines
      const startEditOnLine = (line: TextLine, newCaret: number) => {
        const flowLine = findMatchingFlowLine(line, renderResult.textLines) ?? line;
        const caret = Math.min(newCaret, flowLine.text.length);
        if (editingLine?.id === flowLine.id) {
          setCaretPos(caret);
          caretVisibleRef.current = true;
          setTimeout(() => {
            if (hiddenInputRef.current) {
              hiddenInputRef.current.focus({ preventScroll: true });
              hiddenInputRef.current.setSelectionRange(caret, caret);
            }
          }, 0);
          return;
        }
        const startNew = () => {
          beginEditSession(flowLine, caret);
          setTimeout(() => {
            if (hiddenInputRef.current) {
              hiddenInputRef.current.focus({ preventScroll: true });
              hiddenInputRef.current.setSelectionRange(caret, caret);
            }
          }, 0);
        };
        if (editingLine) {
          void handleEditSubmit(false).then(startNew);
        } else {
          startNew();
        }
      };

      const hit = hitTestTextLine(pdfX, pdfY, renderResult.textLines);
      if (hit) {
        startEditOnLine(hit, caretIndexFromLineX(pdfX, hit));
        return;
      }

      const nearHit = findNearestTextLine(pdfX, pdfY, renderResult.textLines, 12);
      if (nearHit) {
        startEditOnLine(nearHit, caretIndexFromLineX(pdfX, nearHit));
        return;
      }

      {
          const spatialHit = spatialIndexRef.current
            ? hitTestDisplayList(spatialIndexRef.current, pdfX, pdfY)
            : null;
          const itemHit = spatialHit && (spatialHit.data.type === 'image' || spatialHit.data.type === 'path')
            ? spatialHit.data as ImageItem | PathItem
            : null;
          if (itemHit) {
            if (editingLine) handleEditSubmit();
            setSelectedDisplayItem(itemHit);
            setSelectedLine(null);
            setEditingLine(null);
            setActiveTool('select');
            return;
          }
          setSelectedDisplayItem(null);
          if (editingLine) {
            handleEditSubmit();
          } else {
            setEditingLine(null);
            setSelectedLine(null);
          }
          setActiveFloatingTextId(null);
          setActiveFloatingImageId(null);
      }
    } else if (activeTool === 'addtext') {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }

      if (!doc || !renderResult) return;
      const page = doc.pages[currentPage];

      const newBox: FloatingText = {
        id: Math.random().toString(36).substr(2, 9),
        pdfX,
        pdfY,
        text: 'New Text',
        fontSize: textFontSize,
        fontFamily: textFontFamily,
        color: textColor,
      };

      setFloatingTexts(prev => [...prev, newBox]);
      setActiveFloatingTextId(newBox.id);
      setActiveTool('text');

    } else if (activeTool === 'highlight') {
      const hit = hitTestTextLine(pdfX, pdfY, renderResult.textLines);
      if (hit && hit.runs[0] && engineRef.current && doc) {
        setSelectedLine(hit);
        try {
          const [r, g, b] = hexToRGB(highlightColor);
          engineRef.current.addHighlightFromLineSelection(
            doc,
            currentPage,
            hit,
            0,
            hit.text.length,
            [r, g, b],
            'Highlight',
          );
          setIsDirty(true);
          setRenderKey(k => k + 1);
        } catch (err) {
          console.warn('[Editor] Highlight annotation failed:', err);
        }
      }
    }
  }, [renderResult, doc, currentPage, scale, activeTool, editingLine, handleEditSubmit, beginEditSession, displayItems, textFontSize, textColor]);

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
    const hit =
      hitTestTextLine(pdfX, pdfY, renderResult.textLines) ??
      findNearestTextLine(pdfX, pdfY, renderResult.textLines, 16);
    if (hit) {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
        blurTimeoutRef.current = null;
      }
      const flowLine = findMatchingFlowLine(hit, renderResult.textLines) ?? hit;
      const newCaret = caretIndexFromLineX(pdfX, flowLine);
      if (editingLine && editingLine.id !== flowLine.id) {
        void handleEditSubmit(false).then(() => beginEditSession(flowLine, newCaret));
        return;
      }
      beginEditSession(flowLine, newCaret);
      setTimeout(() => {
        if (hiddenInputRef.current) {
          hiddenInputRef.current.focus({ preventScroll: true });
          hiddenInputRef.current.setSelectionRange(newCaret, newCaret);
        }
      }, 0);
    }
  }, [renderResult, doc, currentPage, scale, activeTool, editingLine, handleEditSubmit, beginEditSession]);

  const applyEraser = useCallback((x: number, y: number) => {
    const eraserRadius = eraserSize / 2;
    setDrawnPaths(prev => {
      let newPaths: DrawnPath[] = [];
      let modified = false;
      for (const path of prev) {
        let currentSubPath: { x: number, y: number }[] = [];
        for (const p of path.points) {
          const dx = p.x - x;
          const dy = p.y - y;
          if (Math.sqrt(dx * dx + dy * dy) > eraserRadius) {
            currentSubPath.push(p);
          } else {
            if (currentSubPath.length > 0) {
              newPaths.push({ ...path, id: Math.random().toString(36).substr(2, 9), points: currentSubPath });
              currentSubPath = [];
              modified = true;
            }
          }
        }
        if (currentSubPath.length > 0) {
          if (currentSubPath.length === path.points.length) {
            newPaths.push(path);
          } else {
            newPaths.push({ ...path, id: Math.random().toString(36).substr(2, 9), points: currentSubPath });
            modified = true;
          }
        }
      }
      return modified ? newPaths : prev;
    });
  }, [eraserSize]);

  // ── Commit drawings, texts, and images to PDF ──
  const commitDrawingsToPdf = useCallback(async (pathsToCommit?: DrawnPath[], textsToCommit?: FloatingText[], imagesToCommit?: FloatingImage[]) => {
    const paths = pathsToCommit || drawnPaths;
    const fTexts = textsToCommit || floatingTexts;
    const fImages = imagesToCommit || floatingImages;
    if (!doc || !engineRef.current || (paths.length === 0 && fTexts.length === 0 && fImages.length === 0)) return;
    const engine = engineRef.current;
    const page = doc.pages[currentPage];
    let currentObjNum = engine.getNextObjNum(doc);

    const pageHeight = renderResult?.pageHeight || page.mediaBox.height;

    for (const p of paths) {
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
      const rect = { x: minX - lw, y: minY - lw, width: (maxX - minX) + lw * 2, height: (maxY - minY) + lw * 2 };
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

    if (fTexts.length > 0 || fImages.length > 0) {
      let contentBytes = engine.getPageContentBytes(page, doc.objects);
      let newContentBytes: any = new Uint8Array(contentBytes);

      for (const ft of fTexts) {
        if (!ft.text.trim()) continue;
        const rgb = hexToRGB(ft.color);

        newContentBytes = engine.insertTextRun(
          newContentBytes, page, doc.objects,
          ft.text, ft.pdfX, ft.pdfY, ft.fontSize, rgb
        );
      }

      for (const fi of fImages) {
        const { newContentBytes: b } = await engine.insertImageRun(
          newContentBytes, page, doc.objects,
          fi.dataUrl, fi.pdfX, fi.pdfY, fi.pdfWidth, fi.pdfHeight,
          () => {
            const num = currentObjNum;
            currentObjNum++;
            return num;
          }
        );
        newContentBytes = b;
      }

      engine.updatePageContent(page.contentRefs, newContentBytes, doc.objects).catch((e: Error) => {
        console.error('[Editor] Failed to commit content:', e);
      });
    }

    setDrawnPaths([]);
    setFloatingTexts([]);
    setFloatingImages([]);
    setActiveFloatingTextId(null);
    setActiveFloatingImageId(null);
  }, [doc, currentPage, drawnPaths, floatingTexts, floatingImages, scale, renderResult]);

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
        id: Math.random().toString(36).substr(2, 9),
        type: activeTool as PathType,
        color: activeTool === 'draw' ? drawColor : highlightColor,
        size: activeTool === 'draw' ? drawSize : highlightSize,
        points: [...currentDrawPath.current]
      };

      setDrawnPaths(prev => [...prev, newPath]);
    }
    currentDrawPath.current = [];
  }, [isDrawing, activeTool, drawColor, drawSize, highlightColor, highlightSize, commitDrawingsToPdf]);

  const handleFloatingTextPointerDown = useCallback((e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    setActiveFloatingTextId(id);
    setActiveFloatingImageId(null);
    const box = floatingTexts.find(b => b.id === id);
    if (!box) return;
    dragInfo.current = {
      id,
      type: 'text',
      startX: e.clientX,
      startY: e.clientY,
      startPdfX: box.pdfX,
      startPdfY: box.pdfY
    };

    const handleMove = (me: PointerEvent) => {
      if (!dragInfo.current || !doc || !renderResult) return;
      const dx = me.clientX - dragInfo.current.startX;
      const dy = me.clientY - dragInfo.current.startY;
      const pdfDx = dx / scale;
      const pdfDy = -dy / scale;

      setFloatingTexts(prev => prev.map(p => p.id === id ? {
        ...p,
        pdfX: dragInfo.current!.startPdfX + pdfDx,
        pdfY: dragInfo.current!.startPdfY + pdfDy,
      } : p));
    };

    const handleUp = () => {
      dragInfo.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [floatingTexts, scale, doc, renderResult]);

  const handleFloatingImagePointerDown = useCallback((e: React.PointerEvent, id: string) => {
    e.stopPropagation();
    setActiveFloatingImageId(id);
    setActiveFloatingTextId(null);
    const box = floatingImages.find(b => b.id === id);
    if (!box) return;
    dragInfo.current = {
      id,
      type: 'image',
      startX: e.clientX,
      startY: e.clientY,
      startPdfX: box.pdfX,
      startPdfY: box.pdfY
    };

    const handleMove = (me: PointerEvent) => {
      if (!dragInfo.current || !doc || !renderResult) return;
      const dx = me.clientX - dragInfo.current.startX;
      const dy = me.clientY - dragInfo.current.startY;
      const pdfDx = dx / scale;
      const pdfDy = -dy / scale;

      setFloatingImages(prev => prev.map(p => p.id === id ? {
        ...p,
        pdfX: dragInfo.current!.startPdfX + pdfDx,
        pdfY: dragInfo.current!.startPdfY + pdfDy,
      } : p));
    };

    const handleUp = () => {
      dragInfo.current = null;
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
  }, [floatingImages, scale, doc, renderResult]);

  const handleImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const dataUrl = event.target?.result as string;
      const img = new window.Image();
      img.onload = () => {
        if (replacingImageIdRef.current) {
          // Replace existing
          setFloatingImages(prev => prev.map(p => p.id === replacingImageIdRef.current ? { ...p, dataUrl } : p));
          replacingImageIdRef.current = null;
        } else {
          // Add new
          if (!doc || !renderResult) return;
          const page = doc.pages[currentPage];

          let pdfWidth = img.width;
          let pdfHeight = img.height;
          const maxDim = 200;
          if (pdfWidth > maxDim || pdfHeight > maxDim) {
            const ratio = Math.min(maxDim / pdfWidth, maxDim / pdfHeight);
            pdfWidth *= ratio;
            pdfHeight *= ratio;
          }

          const pdfX = page.mediaBox.width / 2 - pdfWidth / 2;
          const pdfY = page.mediaBox.height / 2 + pdfHeight / 2; // Center of screen

          const newImg: FloatingImage = {
            id: Math.random().toString(36).substr(2, 9),
            pdfX,
            pdfY,
            pdfWidth,
            pdfHeight,
            dataUrl
          };
          setFloatingImages(prev => [...prev, newImg]);
          setActiveFloatingImageId(newImg.id);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    if (fileInputRef.current) fileInputRef.current.value = ''; // reset
  }, [doc, currentPage, renderResult]);


  // ── Hidden / line input — preview only; PDF commits on submit ──
  const handleHiddenInput = useCallback((e: React.FormEvent<HTMLTextAreaElement | HTMLInputElement>) => {
    if (!editingLine) return;
    const newVal = (e.target as HTMLTextAreaElement | HTMLInputElement).value;
    setEditText(newVal);
    const sel = (e.target as HTMLTextAreaElement | HTMLInputElement).selectionStart ?? newVal.length;
    setCaretPos(sel);
    caretVisibleRef.current = true;
  }, [editingLine]);

  const handleHiddenKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
    if (!editingLine) return;
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleEditSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleEditCancel();
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      setTimeout(() => {
        const sel = hiddenInputRef.current?.selectionStart ?? caretPos;
        setCaretPos(sel);
        caretVisibleRef.current = true;
      }, 0);
    }
  }, [editingLine, caretPos, handleEditSubmit, handleEditCancel, handleUndo, handleRedo]);

  const handleHiddenBlur = useCallback(() => {
    if (!editingLine) return;
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }
    blurTimeoutRef.current = setTimeout(() => {
      blurTimeoutRef.current = null;
      if (editingLineRef.current) {
        handleEditSubmit();
      }
    }, 150);
  }, [editingLine, handleEditSubmit]);

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
  // ── Watermark Handlers ──
  const handleWatermarkImageUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setWatermarkImageFile(file);

    const reader = new FileReader();
    reader.onload = async (ev) => {
      const dataUrl = ev.target?.result as string;
      const img = new window.Image();
      img.onload = () => {
        // Convert the image to JPEG using a canvas because the simplified PDF engine
        // only correctly supports image/jpeg (DCTDecode) without complex FlateDecode logic.
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          // Fill with white background in case of transparent PNG
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0);

          canvas.toBlob(blob => {
            if (blob) {
              blob.arrayBuffer().then(buf => {
                setWatermarkImageBytes(new Uint8Array(buf));
                setWatermarkImageDims({ width: img.naturalWidth, height: img.naturalHeight });

                // Override the file to be considered JPEG
                const jpegFile = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
                setWatermarkImageFile(jpegFile);
              });
            }
          }, 'image/jpeg', 0.9);
        }
      };
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  }, []);

  const handleWatermarkImageClear = useCallback(() => {
    setWatermarkImageFile(null);
    setWatermarkImageBytes(null);
    setWatermarkImageDims(null);
  }, []);

  const handleApplyWatermark = useCallback(() => {
    if (!doc || !engineRef.current) return;
    try {
      let wm: Watermark;

      const pageIndices: number[] = [];
      const totalPages = doc.pages.length;
      const fromIdx = Math.max(0, watermarkPageFrom - 1);
      const toIdx = Math.min(totalPages - 1, watermarkPageTo - 1);
      for (let i = fromIdx; i <= toIdx; i++) {
        pageIndices.push(i);
      }

      if (watermarkType === 'text') {
        const r = parseInt(watermarkColor.slice(1, 3), 16) / 255;
        const g = parseInt(watermarkColor.slice(3, 5), 16) / 255;
        const b = parseInt(watermarkColor.slice(5, 7), 16) / 255;

        wm = {
          id: `wm-${Date.now()}`,
          type: 'text',
          text: watermarkText,
          opacity: watermarkOpacity / 100,
          blendMode: watermarkBlendMode,
          color: [r, g, b],
          rotation: watermarkRotation,
          tile: watermarkMosaic,
          layer: watermarkLayer,
          fontName: watermarkFontName,
          fontSize: Math.round(72 * (watermarkSize / 100)),
          position: watermarkPosition as any,
          pageIndices
        };
      } else if (watermarkType === 'shape') {
        const r = parseInt(watermarkColor.slice(1, 3), 16) / 255;
        const g = parseInt(watermarkColor.slice(3, 5), 16) / 255;
        const b = parseInt(watermarkColor.slice(5, 7), 16) / 255;

        const sr = parseInt(watermarkShapeColor.slice(1, 3), 16) / 255;
        const sg = parseInt(watermarkShapeColor.slice(3, 5), 16) / 255;
        const sb = parseInt(watermarkShapeColor.slice(5, 7), 16) / 255;

        const fontSizePt = Math.round(72 * (watermarkSize / 100));
        const textWidth = watermarkText.length * fontSizePt * 0.5;
        
        let finalWidth = textWidth + 40;
        let finalHeight = fontSizePt + 40;
        if (watermarkShapeType === 'circle') {
          const maxDim = Math.max(finalWidth, finalHeight);
          finalWidth = maxDim;
          finalHeight = maxDim;
        }
        
        wm = {
          id: `wm-${Date.now()}`,
          type: 'shape',
          shape: watermarkShapeType,
          text: watermarkText,
          fontName: watermarkFontName,
          fontSize: fontSizePt,
          textColor: [r, g, b],
          shapeColor: [sr, sg, sb],
          width: finalWidth,
          height: finalHeight,
          opacity: watermarkOpacity / 100,
          blendMode: watermarkBlendMode,
          rotation: watermarkRotation,
          tile: watermarkMosaic,
          layer: watermarkLayer,
          position: watermarkPosition as any,
          pageIndices
        } as any;
      } else {
        if (!watermarkImageBytes || !watermarkImageDims || !watermarkImageFile) {
          setError('Please upload an image first');
          return;
        }

        const mimeType = watermarkImageFile.type === 'image/png' ? 'image/png' : 'image/jpeg';

        wm = {
          id: `wm-${Date.now()}`,
          type: 'image',
          imageBytes: watermarkImageBytes,
          mimeType,
          width: watermarkImageDims.width * (watermarkSize / 100),
          height: watermarkImageDims.height * (watermarkSize / 100),
          opacity: watermarkOpacity / 100,
          blendMode: watermarkBlendMode,
          rotation: watermarkRotation,
          tile: watermarkMosaic,
          layer: watermarkLayer,
          position: watermarkPosition as any,
          pageIndices
        };
      }

      const results = engineRef.current.applyWatermarks(doc, [wm], () => engineRef.current!.getNextObjNum(doc));

      const updatePromises: Promise<void>[] = [];
      results.forEach((newBytes, pageIdx) => {
        const page = doc.pages[pageIdx];
        updatePromises.push(
          engineRef.current!.updatePageContent(page.contentRefs, newBytes, doc.objects)
        );
      });

      Promise.all(updatePromises).then(() => {
        setDoc({ ...doc });
        setRenderKey(k => k + 1);
        setWatermarkLivePreview(false);
        setShowApplySuccessModal(true);
      }).catch(err => {
        console.error('[Editor] Apply watermark failed:', err);
        setError(`Failed to apply watermark: ${err instanceof Error ? err.message : String(err)}`);
      });
    } catch (e) {
      console.error('[Editor] Apply watermark failed:', e);
      setError(`Failed to apply watermark: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, watermarkType, watermarkText, watermarkFontName, watermarkOpacity, watermarkRotation, watermarkSize, watermarkPosition, watermarkMosaic, watermarkPageFrom, watermarkPageTo, watermarkLayer, watermarkColor, watermarkShapeColor, watermarkShapeType, watermarkImageBytes, watermarkImageDims, watermarkImageFile, watermarkBlendMode]);

  const handleScanWatermarks = useCallback(() => {
    if (!doc || !engineRef.current) return;
    try {
      const detections = engineRef.current.detectWatermarks(doc);
      setDetectedWatermarks(detections);
    } catch (e) {
      console.error('[Editor] Scan watermarks failed:', e);
      setError(`Failed to scan watermarks: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc]);

  const handleConfirmRemoveWatermarks = useCallback(() => {
    setIsConfirmingRemoval(true);
  }, []);

  const executeRemoveWatermarks = useCallback(() => {
    if (!doc || !engineRef.current || !detectedWatermarks) return;
    try {
      const removal = engineRef.current.removeWatermarks(doc, detectedWatermarks);
      console.log('[Editor] Removed watermarks:', removal);
      setDoc({ ...doc });
      setRenderKey(k => k + 1);
      setDetectedWatermarks(null);
      setIsConfirmingRemoval(false);
    } catch (e) {
      console.error('[Editor] Remove watermarks failed:', e);
      setError(`Failed to remove watermarks: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, detectedWatermarks]);

  const handleCancelScan = useCallback(() => {
    setDetectedWatermarks(null);
  }, []);


  // ── Download / Save ──
  const handleDownload = useCallback(async () => {
    if (!doc || !engineRef.current) return;
    try {
      setIsSaving(true);
      await commitDrawingsToPdf();
      const engine = engineRef.current;
      const bytes = saveMode === 'quick'
        ? await engine.saveQuick(doc)
        : await engine.saveOptimized(doc);
      const blob = new Blob([bytes as unknown as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName || 'edited.pdf';
      a.click();
      URL.revokeObjectURL(url);
      setIsDirty(false);
    } catch (e) {
      console.error('[Editor] Download failed:', e);
      setError(`Download failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSaving(false);
    }
  }, [doc, fileName, saveMode, commitDrawingsToPdf]);

  const handleClose = useCallback(async () => {
    await clearPdfFromStorage();
    router.push('/');
  }, [router]);

  // ── Page Operations ──
  const handleDeletePage = useCallback((index: number) => {
    if (!doc || !engineRef.current) return;
    try {
      engineRef.current.deletePage(doc, index);
      setDoc({ ...doc });
      setTotalPages(doc.pages.length);
      if (currentPage >= doc.pages.length) {
        setCurrentPage(Math.max(0, doc.pages.length - 1));
      }
    } catch (e) {
      setError(`Failed to delete page: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, currentPage]);

  const handleInsertBlankPage = useCallback((index: number) => {
    if (!doc || !engineRef.current) return;
    try {
      engineRef.current.insertBlankPage(doc, index);
      setDoc({ ...doc });
      setTotalPages(doc.pages.length);
      if (currentPage >= index) {
        setCurrentPage(currentPage + 1);
      }
    } catch (e) {
      setError(`Failed to insert blank page: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, currentPage]);

  const handleInsertPdf = useCallback(async (index: number, file: File) => {
    if (!doc || !engineRef.current) return;
    try {
      const buffer = await file.arrayBuffer();
      const sourceDoc = await engineRef.current.parsePDF(new Uint8Array(buffer));
      engineRef.current.insertPagesFromDocument(doc, sourceDoc, index);
      setDoc({ ...doc });
      setTotalPages(doc.pages.length);
      if (currentPage >= index) {
        setCurrentPage(currentPage + sourceDoc.pages.length);
      }
    } catch (e) {
      setError(`Failed to insert PDF: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, [doc, currentPage]);


  // ── Keyboard shortcuts (global — NOT during editing) ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't intercept when the hidden input has focus (editing)
      if (editingLine) return;

      // Don't intercept when the user is typing in any text box or input
      if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;

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
  }, [goToPrev, goToNext, zoomIn, zoomOut, editingLine]);

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

  const eraserSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${eraserSize}" height="${eraserSize}" viewBox="0 0 ${eraserSize} ${eraserSize}"><circle cx="${eraserSize / 2}" cy="${eraserSize / 2}" r="${eraserSize / 2 - 1}" fill="rgba(255,255,255,0.4)" stroke="black" stroke-width="1"/></svg>`;
  const eraserCursorUrl = `url('data:image/svg+xml;utf8,${encodeURIComponent(eraserSvg)}') ${eraserSize / 2} ${eraserSize / 2}, auto`;

  const cursorForTool = activeTool === 'text' ? 'text'
    : activeTool === 'draw' ? 'crosshair'
      : activeTool === 'highlight' ? 'pointer'
        : activeTool === 'erase' ? eraserCursorUrl
          : 'default';

  // ── Main editor UI ──
  return (
    <div className="flex flex-col h-screen font-sans bg-zinc-950 text-zinc-100 selection:bg-blue-500/30">

      {/* ── Top toolbar ── */}
      <Toolbar
        fileName={fileName}
        currentPage={currentPage}
        totalPages={totalPages}
        scale={scale}
        drawnPaths={drawnPaths}
        isSaving={isSaving}
        canUndo={canUndo}
        canRedo={canRedo}
        onClose={handleClose}
        onPrevPage={goToPrev}
        onNextPage={goToNext}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onClearPaths={() => setDrawnPaths([])}
        onDownload={handleDownload}
        saveMode={saveMode}
        onSaveModeChange={setSaveMode}
        isSearchOpen={isSearchOpen}
        onToggleSearch={() => setIsSearchOpen(!isSearchOpen)}
      />

      <div className="flex-1 flex overflow-hidden">

        {/* ── Left sidebar (Tools only) ── */}
        <ToolsSidebar
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          highlightColor={highlightColor}
        />

        {/* ── Left Sidebar (Properties) ── */}
        <PropertiesSidebar
          activeTool={activeTool}
          setActiveTool={setActiveTool}
          selectedRun={selectedLine?.runs[0] ?? null}
          textFontFamily={textFontFamily}
          setTextFontFamily={setTextFontFamily}
          textFontSize={textFontSize}
          setTextFontSize={handleTextFontSize}
          textBold={textBold}
          setTextBold={handleTextBold}
          textItalic={textItalic}
          setTextItalic={handleTextItalic}
          textUnderline={textUnderline}
          setTextUnderline={handleTextUnderline}
          textColor={textColor}
          setTextColor={handleTextColor}
          textAlign={textAlign}
          setTextAlign={handleTextAlign}
          textOpacity={textOpacity}
          setTextOpacity={setTextOpacity}
          replacingImageIdRef={replacingImageIdRef}
          fileInputRef={fileInputRef}
          drawColor={drawColor}
          setDrawColor={setDrawColor}
          drawSize={drawSize}
          setDrawSize={setDrawSize}
          highlightColor={highlightColor}
          setHighlightColor={setHighlightColor}
          highlightSize={highlightSize}
          setHighlightSize={setHighlightSize}
          eraserSize={eraserSize}
          setEraserSize={setEraserSize}
          selectedDisplayItem={selectedDisplayItem}
          setSelectedDisplayItem={setSelectedDisplayItem}
          displayItems={displayItems}
          formFields={formFields}
          selectedFormField={selectedFormField}
          formFieldDraft={formFieldDraft}
          onFormFieldSelect={handleFormFieldSelect}
          onFormFieldChange={handleFormFieldChange}
          onFlattenForms={handleFlattenForms}
          watermarkType={watermarkType}
          setWatermarkType={setWatermarkType}
          watermarkShapeType={watermarkShapeType}
          setWatermarkShapeType={setWatermarkShapeType}
          watermarkShapeColor={watermarkShapeColor}
          setWatermarkShapeColor={setWatermarkShapeColor}
          watermarkImageFile={watermarkImageFile}
          onWatermarkImageUpload={handleWatermarkImageUpload}
          onWatermarkImageClear={handleWatermarkImageClear}
          watermarkText={watermarkText}
          setWatermarkText={setWatermarkText}
          watermarkFontName={watermarkFontName}
          setWatermarkFontName={setWatermarkFontName}
          watermarkOpacity={watermarkOpacity}
          setWatermarkOpacity={setWatermarkOpacity}
          watermarkRotation={watermarkRotation}
          setWatermarkRotation={setWatermarkRotation}
          watermarkSize={watermarkSize}
          setWatermarkSize={setWatermarkSize}
          watermarkPosition={watermarkPosition}
          setWatermarkPosition={setWatermarkPosition}
          watermarkBlendMode={watermarkBlendMode}
          setWatermarkBlendMode={setWatermarkBlendMode}
          watermarkMosaic={watermarkMosaic}
          setWatermarkMosaic={setWatermarkMosaic}
          watermarkPageFrom={watermarkPageFrom}
          setWatermarkPageFrom={setWatermarkPageFrom}
          watermarkPageTo={watermarkPageTo}
          setWatermarkPageTo={setWatermarkPageTo}
          watermarkLayer={watermarkLayer}
          setWatermarkLayer={setWatermarkLayer}
          watermarkColor={watermarkColor}
          setWatermarkColor={setWatermarkColor}
          watermarkLivePreview={watermarkLivePreview}
          setWatermarkLivePreview={setWatermarkLivePreview}
          onApplyWatermark={handleApplyWatermark}
          hasScannedWatermarks={detectedWatermarks !== null}
          detectedWatermarksCount={detectedWatermarks?.length}
          onScanWatermarks={handleScanWatermarks}
          onRemoveWatermarks={handleConfirmRemoveWatermarks}
          onCancelScan={handleCancelScan}
        />

        <input
          type="file"
          accept="image/*"
          ref={fileInputRef}
          className="hidden"
          onChange={handleImageUpload}
        />

        {/* ── Canvas area ── */}
        <div className="flex-1 overflow-auto relative flex justify-center items-start py-12 checkerboard">
          {/* Floating Search & OCR Panel */}
          {isSearchOpen && (
            <div className="absolute top-4 right-4 z-40 flex flex-col items-end gap-3 w-64 pointer-events-none animate-in fade-in slide-in-from-top-4 duration-200">
              <div className="pointer-events-auto flex items-center justify-between gap-2 bg-zinc-900/95 backdrop-blur-md px-3 py-2 rounded-lg border border-zinc-700/80 shadow-lg w-full">
                <button
                  onClick={() => void handleRecognizeText()}
                  className="flex items-center gap-2 text-xs font-semibold text-zinc-300 hover:text-white transition-colors"
                  title="OCR recognize (stub)"
                >
                  <Type size={14} /> Recognize text
                </button>
                {isDirty && <span className="text-[10px] text-amber-400 font-medium border-l border-zinc-700/50 pl-2">Unsaved</span>}
              </div>
              <div className="pointer-events-auto w-full bg-zinc-900/95 backdrop-blur-md rounded-xl border border-zinc-700/80 shadow-2xl overflow-hidden">
                <FindReplacePanel onFindReplace={handleFindReplace} />
              </div>
            </div>
          )}
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

            {/* DOM overlays for FloatingText */}
            {activeTool === 'watermark' && watermarkLivePreview && (
              <WatermarkPreview 
                doc={doc}
                currentPage={currentPage}
                scale={scale}
                watermarkType={watermarkType}
                watermarkText={watermarkText}
                watermarkFontName={watermarkFontName}
                watermarkSize={watermarkSize}
                watermarkColor={watermarkColor}
                watermarkOpacity={watermarkOpacity}
                watermarkRotation={watermarkRotation}
                watermarkMosaic={watermarkMosaic}
                watermarkPosition={watermarkPosition}
                watermarkImageDims={watermarkImageDims}
                watermarkImageFile={watermarkImageFile}
                watermarkShapeType={watermarkShapeType}
                watermarkShapeColor={watermarkShapeColor}
                watermarkBlendMode={watermarkBlendMode}
              />
            )}
            
            {/* Detected watermarks dotted boxes */}
            {activeTool === 'watermark' && detectedWatermarks?.filter(d => d.pageIndex === currentPage).map(dw => 
              dw.positions.map((pos, i) => {
                const { cssX, cssY } = pdfToCanvas(
                  pos.x, 
                  pos.y, 
                  scale, 
                  doc?.pages[currentPage]?.mediaBox.height || 0,
                  doc?.pages[currentPage]?.mediaBox.x || 0,
                  doc?.pages[currentPage]?.mediaBox.y || 0
                );
                const boxW = (pos.width || 120) * scale;
                const boxH = (pos.height || 60) * scale;
                const rot = pos.rotation ?? dw.rotation ?? 0;
                
                return (
                  <div 
                    key={`det-${dw.id}-${i}`}
                    className="absolute border-2 border-red-500 border-dashed bg-red-500/20 rounded z-50 pointer-events-none animate-in fade-in zoom-in duration-200"
                    style={{ 
                      left: cssX, 
                      top: cssY, 
                      width: boxW, 
                      height: boxH, 
                      transform: `translate(-50%, -50%) rotate(${-rot}deg)` 
                    }}
                  />
                );
              })
            )}
            
            {floatingTexts.map(ft => {
              const { cssX, cssY } = pdfToCanvas(
                ft.pdfX,
                ft.pdfY,
                scale,
                doc?.pages[currentPage]?.mediaBox.height || 0,
                doc?.pages[currentPage]?.mediaBox.x || 0,
                doc?.pages[currentPage]?.mediaBox.y || 0
              );
              const isActive = activeFloatingTextId === ft.id;

              return (
                <div
                  key={ft.id}
                  className={`absolute z-20 cursor-move border-2 ${isActive ? 'border-blue-500 border-dashed' : 'border-transparent hover:border-zinc-500 hover:border-dashed'} p-1 -m-1`}
                  style={{
                    left: cssX,
                    top: cssY - (ft.fontSize * scale),
                  }}
                  onPointerDown={(e) => handleFloatingTextPointerDown(e, ft.id)}
                  onClick={(e) => e.stopPropagation()}
                >
                  {isActive && (
                    <button
                      className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full p-1 shadow hover:bg-red-600 transition-colors z-30"
                      onClick={(e) => {
                        e.stopPropagation();
                        setFloatingTexts(prev => prev.filter(p => p.id !== ft.id));
                        if (activeFloatingTextId === ft.id) setActiveFloatingTextId(null);
                      }}
                    >
                      <X size={12} />
                    </button>
                  )}
                  <textarea
                    value={ft.text}
                    onChange={(e) => {
                      setFloatingTexts(prev => prev.map(p => p.id === ft.id ? { ...p, text: e.target.value } : p));
                    }}
                    onFocus={() => setActiveFloatingTextId(ft.id)}
                    className="bg-transparent outline-none overflow-hidden block resize"
                    style={{
                      fontFamily: ft.fontFamily,
                      fontSize: ft.fontSize * scale,
                      color: ft.color,
                      minWidth: '100px',
                      minHeight: `${ft.fontSize * scale * 1.5}px`,
                      width: ft.pdfWidth ? `${ft.pdfWidth * scale}px` : undefined,
                      height: ft.pdfHeight ? `${ft.pdfHeight * scale}px` : undefined,
                    }}
                    onPointerDown={e => {
                      if (isActive) e.stopPropagation();
                    }}
                    onMouseUp={e => {
                      // Capture size after resize handle is released
                      const target = e.target as HTMLTextAreaElement;
                      const w = target.offsetWidth / scale;
                      const h = target.offsetHeight / scale;
                      setFloatingTexts(prev => prev.map(p => p.id === ft.id ? { ...p, pdfWidth: w, pdfHeight: h } : p));
                    }}
                  />
                </div>
              );
            })}

            {/* DOM overlays for FloatingImage */}
            {floatingImages.map(fi => {
              const { cssX, cssY } = pdfToCanvas(
                fi.pdfX,
                fi.pdfY,
                scale,
                doc?.pages[currentPage]?.mediaBox.height || 0,
                doc?.pages[currentPage]?.mediaBox.x || 0,
                doc?.pages[currentPage]?.mediaBox.y || 0
              );
              const isActive = activeFloatingImageId === fi.id;

              return (
                <div
                  key={fi.id}
                  className={`absolute z-20 cursor-move border-2 ${isActive ? 'border-blue-500 border-dashed' : 'border-transparent hover:border-zinc-500 hover:border-dashed'} p-1 -m-1`}
                  style={{
                    left: cssX,
                    top: cssY,
                    width: fi.pdfWidth * scale + 8, // +8 for padding/border
                    height: fi.pdfHeight * scale + 8,
                  }}
                  onPointerDown={(e) => handleFloatingImagePointerDown(e, fi.id)}
                  onClick={(e) => e.stopPropagation()}
                >
                  <img
                    src={fi.dataUrl}
                    alt="floating"
                    className="w-full h-full object-fill pointer-events-none"
                  />

                  {isActive && (
                    <>
                      <button
                        className="absolute -top-3 -right-3 bg-red-500 text-white rounded-full p-1 shadow hover:bg-red-600 transition-colors z-30"
                        title="Delete Image"
                        onClick={(e) => {
                          e.stopPropagation();
                          setFloatingImages(prev => prev.filter(p => p.id !== fi.id));
                          if (activeFloatingImageId === fi.id) setActiveFloatingImageId(null);
                        }}
                      >
                        <X size={12} />
                      </button>
                      <button
                        className="absolute -bottom-3 -right-3 bg-blue-500 text-white rounded-full p-1 shadow hover:bg-blue-600 transition-colors z-30"
                        title="Replace Image"
                        onClick={(e) => {
                          e.stopPropagation();
                          replacingImageIdRef.current = fi.id;
                          fileInputRef.current?.click();
                        }}
                      >
                        <Image size={12} />
                      </button>

                      {/* Dimensions panel in cm */}
                      <div
                        className="absolute top-0 -right-[110px] bg-zinc-900 text-white rounded p-2 shadow-xl border border-zinc-700 text-xs flex flex-col gap-2 z-30 w-24"
                        onClick={e => e.stopPropagation()}
                        onPointerDown={e => e.stopPropagation()}
                      >
                        <div className="text-[9px] text-zinc-400 font-bold uppercase tracking-wider mb-0.5">Dimensions</div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-zinc-500 w-3 text-center">W</span>
                          <input
                            type="number"
                            value={Math.round((fi.pdfWidth * 2.54 * 10) / 72) / 10}
                            onChange={e => {
                              const newW = (parseFloat(e.target.value) * 72) / 2.54;
                              if (newW > 0) setFloatingImages(prev => prev.map(p => p.id === fi.id ? { ...p, pdfWidth: newW } : p));
                            }}
                            className="w-10 bg-zinc-800 rounded px-1 py-0.5 text-right no-spinners outline-none focus:ring-1 focus:ring-blue-500"
                            step="0.1"
                          />
                          <span className="text-zinc-500 text-[10px]">cm</span>
                        </div>
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-zinc-500 w-3 text-center">H</span>
                          <input
                            type="number"
                            value={Math.round((fi.pdfHeight * 2.54 * 10) / 72) / 10}
                            onChange={e => {
                              const newH = (parseFloat(e.target.value) * 72) / 2.54;
                              if (newH > 0) setFloatingImages(prev => prev.map(p => p.id === fi.id ? { ...p, pdfHeight: newH } : p));
                            }}
                            className="w-10 bg-zinc-800 rounded px-1 py-0.5 text-right no-spinners outline-none focus:ring-1 focus:ring-blue-500"
                            step="0.1"
                          />
                          <span className="text-zinc-500 text-[10px]">cm</span>
                        </div>
                      </div>
                    </>
                  )}

                  {/* CSS Resize Handle (only active when hovered to avoid drag conflict) */}
                  <div
                    className="absolute bottom-0 right-0 w-3 h-3 cursor-se-resize bg-blue-500/50"
                    onPointerDown={e => {
                      e.stopPropagation(); // prevent dragging
                      const startX = e.clientX;
                      const startY = e.clientY;
                      const startW = fi.pdfWidth * scale;
                      const startH = fi.pdfHeight * scale;

                      const handleMove = (me: PointerEvent) => {
                        const newW = startW + (me.clientX - startX);
                        const newH = startH + (me.clientY - startY);
                        setFloatingImages(prev => prev.map(p => p.id === fi.id ? { ...p, pdfWidth: Math.max(10, newW / scale), pdfHeight: Math.max(10, newH / scale) } : p));
                      };

                      const handleUp = () => {
                        window.removeEventListener('pointermove', handleMove);
                        window.removeEventListener('pointerup', handleUp);
                      };

                      window.addEventListener('pointermove', handleMove);
                      window.addEventListener('pointerup', handleUp);
                    }}
                  />
                </div>
              );
            })}

            {/* Word-like line editor — positioned exactly over the clicked line */}
            {editingLine && editAnchorLineRef.current && renderResult && doc && (() => {
              const anchor = editAnchorLineRef.current!;
              const bounds = getLineBounds(anchor);
              const page = doc.pages[currentPage];
              const { mediaBox } = page;
              const pad = 2;
              const topLeft = pdfToCanvas(
                bounds.x - pad,
                bounds.y + bounds.height + pad,
                scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
              );
              const bottomRight = pdfToCanvas(
                bounds.x + Math.max(bounds.width, editText.length * anchor.fontSize * 0.55) + pad * 4,
                bounds.y - pad,
                scale, renderResult.pageHeight, mediaBox.x, mediaBox.y,
              );
              const left = Math.min(topLeft.cssX, bottomRight.cssX);
              const top = Math.min(topLeft.cssY, bottomRight.cssY);
              const width = Math.max(40, Math.abs(bottomRight.cssX - topLeft.cssX));
              const height = Math.max(anchor.fontSize * scale * 1.1, Math.abs(bottomRight.cssY - topLeft.cssY));
              const primaryRun = anchor.runs[0];
              const fontData = primaryRun ? renderResult.fonts.get(primaryRun.fontName) : undefined;
              const [r, g, b] = primaryRun?.fillColor || [0, 0, 0];
              return (
                <textarea
                  ref={hiddenInputRef}
                  value={editText}
                  onInput={handleHiddenInput}
                  onKeyDown={handleHiddenKeyDown}
                  onBlur={handleHiddenBlur}
                  rows={1}
                  aria-label="Edit line"
                  spellCheck={false}
                  className="absolute z-20 m-0 border-none outline-none bg-transparent p-0 overflow-hidden resize-none whitespace-nowrap"
                  style={{
                    left,
                    top,
                    width,
                    height,
                    fontSize: anchor.fontSize * scale,
                    lineHeight: `${height}px`,
                    fontFamily: getOverlayFontFamily(primaryRun?.fontName || '', fontData),
                    color: `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`,
                    caretColor: `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`,
                  }}
                />
              );
            })()}
          </div>
        </div>

        {/* ── Right Sidebar: Page Thumbnails ── */}
        <ThumbnailsSidebar
          totalPages={totalPages}
          currentPage={currentPage}
          thumbnails={thumbnails}
          isGeneratingThumbnails={isGeneratingThumbnails}
          onPageSelect={(i) => {
            commitDrawingsToPdf();
            setCurrentPage(i);
          }}
          onDeletePage={handleDeletePage}
          onInsertBlankPage={handleInsertBlankPage}
          onInsertPdf={handleInsertPdf}
        />
      </div>

      {/* ── Bottom status bar ── */}
      <div className="shrink-0">
        <StatusBar
          renderResult={renderResult}
          activeTool={activeTool}
          selectedRun={selectedLine?.runs[0] ?? null}
          doc={doc}
          totalPages={totalPages}
        />
      </div>

      {/* Error toast */}
      {error && (
        <div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-red-500/10 backdrop-blur-md border border-red-500/30 text-red-400 px-4 py-3 rounded-xl text-sm font-medium flex items-center gap-4 shadow-xl z-[100] animate-in slide-in-from-bottom-5 fade-in">
          {error}
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-300 transition-colors">
            <X size={16} />
          </button>
        </div>
      )}
      {isConfirmingRemoval && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-700/50 rounded-xl p-6 shadow-2xl max-w-sm w-full">
            <h3 className="text-white font-medium text-lg mb-2">Remove Watermarks</h3>
            <p className="text-zinc-400 text-sm mb-6">
              Do you really want to remove the detected watermarks from this document? This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button 
                onClick={() => setIsConfirmingRemoval(false)}
                className="px-4 py-2 rounded font-medium text-sm text-zinc-300 hover:text-white hover:bg-zinc-800 transition-colors"
              >
                Cancel
              </button>
              <button 
                onClick={executeRemoveWatermarks}
                className="px-4 py-2 rounded font-medium text-sm bg-red-600 hover:bg-red-700 text-white transition-colors"
              >
                Yes, Remove
              </button>
            </div>
          </div>
        </div>
      )}

      {showApplySuccessModal && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-zinc-900 border border-zinc-700/50 rounded-xl p-6 shadow-2xl max-w-sm w-full text-center">
            <h3 className="text-white font-medium text-lg mb-4">Watermark Applied</h3>
            <p className="text-zinc-400 text-sm mb-6 leading-relaxed">
              Watermark has been applied and live preview is off. To add more watermarks, turn on the live preview to preview it live.
            </p>
            <button 
              onClick={() => setShowApplySuccessModal(false)}
              className="w-full px-4 py-2.5 rounded font-medium text-sm bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              Okay
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
