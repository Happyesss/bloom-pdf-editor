'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { loadPdfFromStorage, clearPdfFromStorage } from '@/lib/pdfStorage';
import { X, Loader2, ChevronLeft, Image } from 'lucide-react';

// We import types only — the engine modules are loaded dynamically
// because they require browser APIs (canvas, DecompressionStream)
import type { PDFDocumentData, RenderResult, TextRun, ImageItem, PathItem, DisplayItem, TextWatermark, ImageWatermark, Watermark, DetectedWatermark } from '@/engine';

import type { EditorTool, ToolDef, PathType, DrawnPath, FloatingText, FloatingImage } from './types';
import { TOOLS } from './types';
import { canvasToPdf, pdfToCanvas, hitTestTextRuns, hitTestDisplayItems, caretIndexFromPdfX, hexToRGB } from './utils';

import { Toolbar } from './components/Toolbar';
import { ToolsSidebar } from './components/ToolsSidebar';
import { PropertiesSidebar } from './components/PropertiesSidebar';

const WatermarkPreview = ({
  doc, currentPage, scale, watermarkType, watermarkText, watermarkFontName, watermarkSize,
  watermarkColor, watermarkOpacity, watermarkRotation, watermarkMosaic, watermarkPosition,
  watermarkImageDims, watermarkImageFile
}: any) => {
  const [imgUrl, setImgUrl] = useState<string | null>(null);

  useEffect(() => {
    if (watermarkType === 'image' && watermarkImageFile) {
      const url = URL.createObjectURL(watermarkImageFile);
      setImgUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setImgUrl(null);
    }
  }, [watermarkType, watermarkImageFile]);

  if (!doc || !doc.pages[currentPage]) return null;
  
  const page = doc.pages[currentPage];
  const pageWidth = page.mediaBox.width;
  const pageHeight = page.mediaBox.height;
  const opacity = watermarkOpacity / 100;
  const fontSizeCss = (72 * (watermarkSize / 100)) * scale;
  const imgWidthCss = watermarkImageDims?.width ? (watermarkImageDims.width * (watermarkSize / 100)) * scale : 0;
  const imgHeightCss = watermarkImageDims?.height ? (watermarkImageDims.height * (watermarkSize / 100)) * scale : 0;
  const padCss = 30 * scale;

  let wmWidthCss = watermarkType === 'text' ? (watermarkText.length * (fontSizeCss / scale) * 0.5 * scale) : imgWidthCss;
  let wmHeightCss = watermarkType === 'text' ? fontSizeCss : imgHeightCss;

  const renderItem = (cx: number, cy: number, key: string) => (
    <div
      key={key}
      style={{
        position: 'absolute',
        left: `${cx}px`,
        top: `${cy}px`,
        transform: `translate(-50%, -50%) rotate(${-watermarkRotation}deg)`,
        opacity,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        pointerEvents: 'none'
      }}
    >
      {watermarkType === 'text' ? (
        <span style={{ fontSize: fontSizeCss, color: watermarkColor, fontFamily: watermarkFontName, whiteSpace: 'pre', lineHeight: 1 }}>
          {watermarkText}
        </span>
      ) : imgUrl ? (
        <img src={imgUrl} style={{ width: imgWidthCss, height: imgHeightCss }} alt="watermark" />
      ) : null}
    </div>
  );

  if (watermarkMosaic) {
    const spacing = 300 * scale;
    const cols = Math.ceil((pageWidth * scale) / spacing) + 1;
    const rows = Math.ceil((pageHeight * scale) / spacing) + 1;
    const tiles = [];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        tiles.push(renderItem(c * spacing, r * spacing, `tile-${r}-${c}`));
      }
    }
    return <div className="absolute inset-0 z-40 pointer-events-none overflow-hidden">{tiles}</div>;
  }

  let cx = (pageWidth / 2) * scale;
  let cy = (pageHeight / 2) * scale;
  
  switch (watermarkPosition) {
    case 'top-left': cx = padCss + wmWidthCss / 2; cy = padCss + wmHeightCss / 2; break;
    case 'top-center': cx = (pageWidth / 2) * scale; cy = padCss + wmHeightCss / 2; break;
    case 'top-right': cx = (pageWidth * scale) - padCss - wmWidthCss / 2; cy = padCss + wmHeightCss / 2; break;
    case 'center-left': cx = padCss + wmWidthCss / 2; cy = (pageHeight / 2) * scale; break;
    case 'center': cx = (pageWidth / 2) * scale; cy = (pageHeight / 2) * scale; break;
    case 'center-right': cx = (pageWidth * scale) - padCss - wmWidthCss / 2; cy = (pageHeight / 2) * scale; break;
    case 'bottom-left': cx = padCss + wmWidthCss / 2; cy = (pageHeight * scale) - padCss - wmHeightCss / 2; break;
    case 'bottom-center': cx = (pageWidth / 2) * scale; cy = (pageHeight * scale) - padCss - wmHeightCss / 2; break;
    case 'bottom-right': cx = (pageWidth * scale) - padCss - wmWidthCss / 2; cy = (pageHeight * scale) - padCss - wmHeightCss / 2; break;
  }

  return <div className="absolute inset-0 z-40 pointer-events-none overflow-hidden">{renderItem(cx, cy, 'single')}</div>;
}

import { ThumbnailsSidebar } from './components/ThumbnailsSidebar';
import { StatusBar } from './components/StatusBar';


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
  const [watermarkType, setWatermarkType] = useState<'text' | 'image'>('text');
  const [watermarkText, setWatermarkText] = useState('Bloom PDF');
  const [watermarkFontName, setWatermarkFontName] = useState('Arial');
  const [watermarkOpacity, setWatermarkOpacity] = useState(25);
  const [watermarkRotation, setWatermarkRotation] = useState(45);
  const [watermarkSize, setWatermarkSize] = useState(100);
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
  
  const [detectedWatermarks, setDetectedWatermarks] = useState<DetectedWatermark[] | null>(null);
  const [isConfirmingRemoval, setIsConfirmingRemoval] = useState(false);

  // Display items (images/paths) for selection overlays
  const [displayItems, setDisplayItems] = useState<(ImageItem | PathItem)[]>([]);
  const [selectedDisplayItem, setSelectedDisplayItem] = useState<ImageItem | PathItem | null>(null);

  // Text properties sidebar state
  const [textFontFamily, setTextFontFamily] = useState('Helvetica');
  const [textFontSize, setTextFontSize] = useState(12);
  const [textColor, setTextColor] = useState('#000000');
  const [textBold, setTextBold] = useState(false);
  const [textItalic, setTextItalic] = useState(false);
  const [textUnderline, setTextUnderline] = useState(false);
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
  const fileInputRef = useRef<HTMLInputElement>(null);
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

    // ── Display item bounding boxes (images/paths) in select/text mode ──
    if ((activeTool === 'select' || activeTool === 'text') && displayItems.length > 0) {
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
          color: [r, g, b],
          rotation: watermarkRotation,
          tile: watermarkMosaic,
          layer: watermarkLayer,
          fontName: watermarkFontName,
          fontSize: Math.round(72 * (watermarkSize / 100)),
          position: watermarkPosition as any,
          pageIndices
        };
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
  }, [doc, watermarkType, watermarkText, watermarkFontName, watermarkOpacity, watermarkRotation, watermarkSize, watermarkPosition, watermarkMosaic, watermarkPageFrom, watermarkPageTo, watermarkLayer, watermarkColor, watermarkImageBytes, watermarkImageDims, watermarkImageFile]);

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
      if (editingRun) return;

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
        onClose={handleClose}
        onPrevPage={goToPrev}
        onNextPage={goToNext}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onClearPaths={() => setDrawnPaths([])}
        onDownload={handleDownload}
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
          selectedRun={selectedRun}
          textFontFamily={textFontFamily}
          setTextFontFamily={setTextFontFamily}
          textFontSize={textFontSize}
          setTextFontSize={setTextFontSize}
          textBold={textBold}
          setTextBold={setTextBold}
          textItalic={textItalic}
          setTextItalic={setTextItalic}
          textUnderline={textUnderline}
          setTextUnderline={setTextUnderline}
          textColor={textColor}
          setTextColor={setTextColor}
          textAlign={textAlign}
          setTextAlign={setTextAlign}
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
          watermarkType={watermarkType}
          setWatermarkType={setWatermarkType}
          watermarkImageFile={watermarkImageFile}
          onWatermarkImageUpload={handleWatermarkImageUpload}
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
                return (
                  <div 
                    key={`det-${dw.id}-${i}`}
                    className="absolute border-2 border-red-500 border-dashed bg-red-500/20 rounded z-50 pointer-events-none animate-in fade-in zoom-in duration-200"
                    style={{ left: cssX, top: cssY, width: 120 * scale, height: 60 * scale, transform: 'translate(-50%, -50%)' }}
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
      <StatusBar
        renderResult={renderResult}
        activeTool={activeTool}
        selectedRun={selectedRun}
        doc={doc}
        totalPages={totalPages}
      />

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
