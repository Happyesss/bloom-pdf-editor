'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as fabric from 'fabric';
import { Trash2 } from 'lucide-react';
import type { ToolType, ToolOptions } from '@/types/editor';
import TextEditLayer from './TextEditLayer';

interface PageCanvasProps {
  pageIndex: number;       // 0-based
  pdfBytes: ArrayBuffer;
  scale: number;
  activeTool: ToolType;
  toolOptions: ToolOptions;
  overlayJson?: string;
  textEdits: Record<string, string>;  // blockId → edited text
  isCurrentPage: boolean;
  onOverlayChange: (pageIndex: number, json: string) => void;
  onHistoryPush: (pageIndex: number, json: string) => void;
  onTextEdit: (pageIndex: number, blockId: string, text: string) => void;
  onHistoryChange?: (canUndo: boolean, canRedo: boolean) => void;
}

export default function PageCanvas({
  pageIndex,
  pdfBytes,
  scale,
  activeTool,
  toolOptions,
  overlayJson,
  textEdits,
  isCurrentPage,
  onOverlayChange,
  onHistoryPush,
  onTextEdit,
  onHistoryChange,
}: PageCanvasProps) {
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  // Bounding box of currently-selected Fabric object (drives floating delete btn)
  const [selectionBounds, setSelectionBounds] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const isDrawingRef = useRef(false);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const activeShapeRef = useRef<fabric.Object | null>(null);
  const lastOverlayRef = useRef<string>('');
  // Keeps the current activeTool available inside effects without being a dep
  const activeToolRef = useRef<ToolType>(activeTool);
  activeToolRef.current = activeTool;
  // Keep onHistoryChange available inside effects without triggering re-runs
  const onHistoryChangeRef = useRef(onHistoryChange);
  onHistoryChangeRef.current = onHistoryChange;
  // Reports current local history state to parent (enables toolbar buttons)
  const reportHistory = () => {
    const idx = localHistoryIndexRef.current;
    const len = localHistoryRef.current.length;
    onHistoryChangeRef.current?.(idx > 0, idx < len - 1);
  };
  // ── Local undo/redo history (per-page canvas state snapshots) ──────────
  const localHistoryRef = useRef<string[]>([]);
  const localHistoryIndexRef = useRef<number>(-1);
  // Prevents saveOverlay from recording a history entry during restoration
  const isRestoringRef = useRef(false);

  // ─── Render PDF page onto the background canvas ───────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function renderPage() {
      const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
      GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';

      const loadingTask = getDocument({ data: pdfBytes.slice(0) });
      const pdf = await loadingTask.promise;
      if (cancelled) return;

      const page = await pdf.getPage(pageIndex + 1);
      if (cancelled) return;

      // Render at device pixel ratio for crisp text on retina/HiDPI displays
      const dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
      const cssViewport = page.getViewport({ scale });
      const renderViewport = page.getViewport({ scale: scale * dpr });
      const canvas = pdfCanvasRef.current;
      if (!canvas) return;

      // Physical pixels (sharp rendering at DPR scale)
      canvas.width = Math.floor(renderViewport.width);
      canvas.height = Math.floor(renderViewport.height);
      // CSS display size — keep exact floats so dimensions state is unchanged
      // relative to before, preventing unnecessary Fabric canvas recreation
      canvas.style.width = `${cssViewport.width}px`;
      canvas.style.height = `${cssViewport.height}px`;
      setDimensions({ width: cssViewport.width, height: cssViewport.height });

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      await page.render({ canvas, canvasContext: ctx, viewport: renderViewport }).promise;
    }

    renderPage().catch(console.error);
    return () => { cancelled = true; };
  }, [pdfBytes, pageIndex, scale]);

  // ─── Init / resize Fabric canvas ─────────────────────────────────────────
  useEffect(() => {
    if (dimensions.width === 0 || dimensions.height === 0) return;
    if (!fabricCanvasRef.current) return;

    if (fabricRef.current) {
      fabricRef.current.dispose();
    }

    const fc = new fabric.Canvas(fabricCanvasRef.current, {
      width: dimensions.width,
      height: dimensions.height,
      selection: true,
      backgroundColor: 'transparent',
    });

    fabricRef.current = fc;

    // Apply current activeTool's pointer-events to the wrapper Fabric just created
    const wrapper = fabricCanvasRef.current?.parentElement;
    if (wrapper) {
      wrapper.style.pointerEvents = activeToolRef.current === 'editText' ? 'none' : 'auto';
    }

    // Restore overlay if exists
    if (overlayJson) {
      try {
        const parsed = JSON.parse(overlayJson);
        fc.loadFromJSON(parsed, () => fc.renderAll());
      } catch {}
    }

    // Object modified → save + push to local history
    const saveOverlay = () => {
      if (isRestoringRef.current) return;
      const json = JSON.stringify(fc.toJSON());
      if (json !== lastOverlayRef.current) {
        // Build history: truncate any redo tail, then append new entry
        const prev = lastOverlayRef.current;
        const sliced = localHistoryRef.current.slice(0, localHistoryIndexRef.current + 1);
        if (sliced.length === 0) sliced.push(prev); // always keep the before-state
        sliced.push(json);
        localHistoryRef.current = sliced;
        localHistoryIndexRef.current = sliced.length - 1;
        lastOverlayRef.current = json;
        onOverlayChange(pageIndex, json);
        reportHistory();
      }
    };

    fc.on('object:modified', saveOverlay);
    fc.on('object:added', saveOverlay);
    fc.on('object:removed', saveOverlay);

    // Track selection for the floating delete button
    const updateSel = () => {
      const active = fc.getActiveObject();
      if (active) {
        const br = active.getBoundingRect();
        setSelectionBounds({ left: br.left, top: br.top, width: br.width, height: br.height });
      } else {
        setSelectionBounds(null);
      }
    };
    fc.on('selection:created', updateSel);
    fc.on('selection:updated', updateSel);
    fc.on('object:moving', updateSel);
    fc.on('object:scaling', updateSel);
    fc.on('selection:cleared', () => setSelectionBounds(null));

    return () => {
      fc.dispose();
      fabricRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensions]);

  // ─── Disable Fabric container pointer events in editText mode ──────────────
  // Use fabricCanvasRef.current.parentElement (the wrapper Fabric creates) instead
  // of wrapperEl (internal Fabric API, not reliably accessible in v7).
  useEffect(() => {
    const wrapper = fabricCanvasRef.current?.parentElement;
    if (!wrapper) return;
    wrapper.style.pointerEvents = activeTool === 'editText' ? 'none' : 'auto';
  }, [activeTool]);

  // ─── Sync overlayJson from store into fabric (external changes only) ──────
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc || !overlayJson) return;
    if (overlayJson === lastOverlayRef.current) return;
    isRestoringRef.current = true;
    try {
      const parsed = JSON.parse(overlayJson);
      fc.loadFromJSON(parsed, () => {
        fc.renderAll();
        isRestoringRef.current = false;
      });
      lastOverlayRef.current = overlayJson;
    } catch {
      isRestoringRef.current = false;
    }
  }, [overlayJson]);

  // ─── Local undo / redo via custom DOM events ──────────────────────────────
  useEffect(() => {
    if (!isCurrentPage) return;

    const applyState = (json: string) => {
      const fc = fabricRef.current;
      if (!fc) return;
      isRestoringRef.current = true;
      try {
        const parsed = JSON.parse(json || '{"objects":[]}');
        fc.loadFromJSON(parsed, () => {
          fc.renderAll();
          isRestoringRef.current = false;
          lastOverlayRef.current = json;
          onOverlayChange(pageIndex, json);
        });
      } catch {
        isRestoringRef.current = false;
      }
    };

    const doUndo = () => {
      const idx = localHistoryIndexRef.current;
      if (idx <= 0) return;
      localHistoryIndexRef.current = idx - 1;
      applyState(localHistoryRef.current[localHistoryIndexRef.current]);
      reportHistory();
    };

    const doRedo = () => {
      const idx = localHistoryIndexRef.current;
      if (idx >= localHistoryRef.current.length - 1) return;
      localHistoryIndexRef.current = idx + 1;
      applyState(localHistoryRef.current[localHistoryIndexRef.current]);
      reportHistory();
    };

    const doDelete = () => {
      const fc = fabricRef.current;
      if (!fc) return;
      const active = fc.getActiveObjects();
      if (active.length === 0) return;
      fc.remove(...active);
      fc.discardActiveObject();
      fc.renderAll();
      const json = JSON.stringify(fc.toJSON());
      lastOverlayRef.current = json;
      onOverlayChange(pageIndex, json);
    };

    window.addEventListener('pdf-editor:undo', doUndo);
    window.addEventListener('pdf-editor:redo', doRedo);
    window.addEventListener('pdf-editor:delete-selection', doDelete);
    return () => {
      window.removeEventListener('pdf-editor:undo', doUndo);
      window.removeEventListener('pdf-editor:redo', doRedo);
      window.removeEventListener('pdf-editor:delete-selection', doDelete);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isCurrentPage, pageIndex, onOverlayChange]);

  // ─── Tool → Fabric mode ──────────────────────────────────────────────────
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc) return;

    fc.isDrawingMode = false;
    fc.selection = true;
    fc.off('mouse:down');
    fc.off('mouse:move');
    fc.off('mouse:up');

    if (activeTool === 'select') {
      fc.selection = true;
      fc.defaultCursor = 'default';
      return;
    }

    // Text edit layer handles everything — Fabric does nothing
    if (activeTool === 'editText') return;

    if (activeTool === 'draw' || activeTool === 'eraser') {
      fc.isDrawingMode = true;
      if (activeTool === 'eraser') {
        fc.freeDrawingBrush = new fabric.PencilBrush(fc);
        fc.freeDrawingBrush.color = '#ffffff';
        fc.freeDrawingBrush.width = toolOptions.strokeWidth * 8;
      } else {
        fc.freeDrawingBrush = new fabric.PencilBrush(fc);
        fc.freeDrawingBrush.color = toolOptions.color;
        fc.freeDrawingBrush.width = toolOptions.strokeWidth;
      }
      return;
    }

    if (activeTool === 'text') {
      fc.defaultCursor = 'text';
      fc.selection = false;
      fc.on('mouse:down', (e) => {
        const pointer = e.scenePoint;
        const textbox = new fabric.Textbox('Click to type...', {
          left: pointer.x,
          top: pointer.y,
          fontSize: toolOptions.fontSize,
          fontFamily: toolOptions.fontFamily,
          fill: toolOptions.color,
          fontWeight: toolOptions.fontBold ? 'bold' : 'normal',
          fontStyle: toolOptions.fontItalic ? 'italic' : 'normal',
          width: 200,
          editable: true,
          selectable: true,
        });
        fc.add(textbox);
        fc.setActiveObject(textbox);
        textbox.enterEditing();
        fc.renderAll();
      });
      return;
    }

    if (activeTool === 'highlight') {
      fc.defaultCursor = 'crosshair';
      fc.selection = false;
      setupRectDraw(fc, `${toolOptions.color}66`, 0, 'transparent');
      return;
    }

    if (activeTool === 'redact') {
      fc.defaultCursor = 'crosshair';
      fc.selection = false;
      setupRectDraw(fc, '#000000', 0, '#000000');
      return;
    }

    if (activeTool === 'stamp') {
      fc.defaultCursor = 'crosshair';
      fc.selection = false;
      const stampDefs: Record<string, { color: string }> = {
        APPROVED:     { color: '#16a34a' },
        REJECTED:     { color: '#dc2626' },
        DRAFT:        { color: '#9ca3af' },
        CONFIDENTIAL: { color: '#dc2626' },
        VOID:         { color: '#dc2626' },
        PAID:         { color: '#16a34a' },
      };
      const stampType = toolOptions.stampType ?? 'APPROVED';
      const def = stampDefs[stampType] ?? stampDefs.APPROVED;
      fc.on('mouse:down', (e) => {
        const ptr = e.scenePoint;
        const stampRect = new fabric.Rect({
          left: 0, top: 0,
          width: 130, height: 42,
          fill: 'transparent',
          stroke: def.color,
          strokeWidth: 3,
          rx: 5, ry: 5,
          selectable: false,
        });
        const stampText = new fabric.Textbox(stampType, {
          left: 8, top: 9,
          width: 114,
          fontSize: 18,
          fontWeight: 'bold',
          fontFamily: 'Arial',
          fill: def.color,
          opacity: 0.85,
          textAlign: 'center',
          selectable: false,
        });
        const group = new fabric.Group([stampRect, stampText], {
          left: ptr.x,
          top: ptr.y,
          selectable: true,
          angle: -15,
        });
        fc.add(group);
        fc.setActiveObject(group);
        fc.renderAll();
        const json = JSON.stringify(fc.toJSON());
        lastOverlayRef.current = json;
        onOverlayChange(pageIndex, json);
      });
      return;
    }

    if (activeTool === 'rectangle') {
      fc.defaultCursor = 'crosshair';
      fc.selection = false;
      setupRectDraw(fc, toolOptions.color, toolOptions.strokeWidth, toolOptions.fillColor);
      return;
    }

    if (activeTool === 'ellipse') {
      fc.defaultCursor = 'crosshair';
      fc.selection = false;
      setupEllipseDraw(fc);
      return;
    }

    if (activeTool === 'line' || activeTool === 'arrow') {
      fc.defaultCursor = 'crosshair';
      fc.selection = false;
      setupLineDraw(fc, activeTool === 'arrow');
      return;
    }

    if (activeTool === 'underline' || activeTool === 'strikethrough') {
      fc.defaultCursor = 'crosshair';
      fc.selection = false;
      setupLineDraw(fc, false, activeTool === 'strikethrough' ? '#ef4444' : '#3b82f6', 2);
      return;
    }

    if (activeTool === 'comment') {
      fc.defaultCursor = 'pointer';
      fc.selection = false;
      fc.on('mouse:down', (e) => {
        const pointer = e.scenePoint;
        const text = window.prompt('Enter comment:');
        if (!text) return;
        const rect = new fabric.Rect({
          left: pointer.x,
          top: pointer.y,
          width: 180,
          height: 60,
          fill: '#fef08a',
          stroke: '#ca8a04',
          strokeWidth: 1,
          rx: 4,
          ry: 4,
        });
        const label = new fabric.Textbox(text, {
          left: pointer.x + 6,
          top: pointer.y + 6,
          width: 168,
          fontSize: 11,
          fill: '#78350f',
          fontFamily: 'Arial',
          selectable: false,
        });
        const group = new fabric.Group([rect, label], {
          left: pointer.x,
          top: pointer.y,
          selectable: true,
        });
        fc.add(group);
        fc.renderAll();
      });
      return;
    }

    // ── Helper: rectangle draw ──────────────────────────────────────────────
    function setupRectDraw(
      canvas: fabric.Canvas,
      stroke: string,
      sw: number,
      fill: string
    ) {
      canvas.on('mouse:down', (e) => {
        isDrawingRef.current = true;
        const ptr = e.scenePoint;
        startPointRef.current = { x: ptr.x, y: ptr.y };
        const rect = new fabric.Rect({
          left: ptr.x,
          top: ptr.y,
          width: 0,
          height: 0,
          stroke,
          strokeWidth: sw,
          fill,
          selectable: false,
          opacity: toolOptions.opacity,
        });
        canvas.add(rect);
        activeShapeRef.current = rect;
      });

      canvas.on('mouse:move', (e) => {
        if (!isDrawingRef.current || !activeShapeRef.current || !startPointRef.current) return;
        const ptr = e.scenePoint;
        const rect = activeShapeRef.current as fabric.Rect;
        const { x, y } = startPointRef.current;
        rect.set({
          left: Math.min(x, ptr.x),
          top: Math.min(y, ptr.y),
          width: Math.abs(ptr.x - x),
          height: Math.abs(ptr.y - y),
        });
        canvas.renderAll();
      });

      canvas.on('mouse:up', () => {
        isDrawingRef.current = false;
        if (activeShapeRef.current) {
          activeShapeRef.current.set({ selectable: true });
          canvas.setActiveObject(activeShapeRef.current);
          activeShapeRef.current = null;
        }
        startPointRef.current = null;
        const json = JSON.stringify(canvas.toJSON());
        lastOverlayRef.current = json;
        onOverlayChange(pageIndex, json);
      });
    }

    function setupEllipseDraw(canvas: fabric.Canvas) {
      canvas.on('mouse:down', (e) => {
        isDrawingRef.current = true;
        const ptr = e.scenePoint;
        startPointRef.current = { x: ptr.x, y: ptr.y };
        const ellipse = new fabric.Ellipse({
          left: ptr.x,
          top: ptr.y,
          rx: 0,
          ry: 0,
          stroke: toolOptions.color,
          strokeWidth: toolOptions.strokeWidth,
          fill: toolOptions.fillColor,
          selectable: false,
        });
        canvas.add(ellipse);
        activeShapeRef.current = ellipse;
      });
      canvas.on('mouse:move', (e) => {
        if (!isDrawingRef.current || !activeShapeRef.current || !startPointRef.current) return;
        const ptr = e.scenePoint;
        const el = activeShapeRef.current as fabric.Ellipse;
        const { x, y } = startPointRef.current;
        el.set({
          left: Math.min(x, ptr.x),
          top: Math.min(y, ptr.y),
          rx: Math.abs(ptr.x - x) / 2,
          ry: Math.abs(ptr.y - y) / 2,
        });
        canvas.renderAll();
      });
      canvas.on('mouse:up', () => {
        isDrawingRef.current = false;
        if (activeShapeRef.current) {
          activeShapeRef.current.set({ selectable: true });
          activeShapeRef.current = null;
        }
        startPointRef.current = null;
        const json = JSON.stringify(canvas.toJSON());
        lastOverlayRef.current = json;
        onOverlayChange(pageIndex, json);
      });
    }

    function setupLineDraw(canvas: fabric.Canvas, arrowHead: boolean, color?: string, sw?: number) {
      canvas.on('mouse:down', (e) => {
        isDrawingRef.current = true;
        const ptr = e.scenePoint;
        startPointRef.current = { x: ptr.x, y: ptr.y };
        const line = new fabric.Line([ptr.x, ptr.y, ptr.x, ptr.y], {
          stroke: color || toolOptions.color,
          strokeWidth: sw || toolOptions.strokeWidth,
          selectable: false,
        });
        canvas.add(line);
        activeShapeRef.current = line;
      });
      canvas.on('mouse:move', (e) => {
        if (!isDrawingRef.current || !activeShapeRef.current || !startPointRef.current) return;
        const ptr = e.scenePoint;
        const line = activeShapeRef.current as fabric.Line;
        line.set({ x2: ptr.x, y2: ptr.y });
        canvas.renderAll();
      });
      canvas.on('mouse:up', () => {
        isDrawingRef.current = false;
        if (activeShapeRef.current) {
          if (arrowHead) {
            const line = activeShapeRef.current as fabric.Line;
            const x1 = line.x1 ?? 0;
            const y1 = line.y1 ?? 0;
            const x2 = line.x2 ?? 0;
            const y2 = line.y2 ?? 0;
            const angle = Math.atan2(y2 - y1, x2 - x1) * (180 / Math.PI);
            const arrowTri = new fabric.Triangle({
              left: x2,
              top: y2,
              width: 12,
              height: 12,
              fill: toolOptions.color,
              angle: angle + 90,
              originX: 'center',
              originY: 'center',
              selectable: false,
            });
            canvas.add(arrowTri);
          }
          activeShapeRef.current.set({ selectable: true });
          activeShapeRef.current = null;
        }
        startPointRef.current = null;
        const json = JSON.stringify(canvas.toJSON());
        lastOverlayRef.current = json;
        onOverlayChange(pageIndex, json);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTool, toolOptions, dimensions]);

  // ─── Listen for insert-image custom event ─────────────────────────────────
  useEffect(() => {
    const handler = (e: Event) => {
      const { dataUrl, pageIndex: targetPage } = (e as CustomEvent).detail;
      if (targetPage !== pageIndex) return;
      const fc = fabricRef.current;
      if (!fc) return;
      fabric.Image.fromURL(dataUrl, { crossOrigin: 'anonymous' }).then((img) => {
        img.scaleToWidth(Math.min(200, dimensions.width * 0.4));
        img.set({ left: 50, top: 50, selectable: true });
        fc.add(img);
        fc.setActiveObject(img);
        fc.renderAll();
        const json = JSON.stringify(fc.toJSON());
        lastOverlayRef.current = json;
        onOverlayChange(pageIndex, json);
      });
    };
    window.addEventListener('pdf-editor:insert-image', handler);
    return () => window.removeEventListener('pdf-editor:insert-image', handler);
  }, [pageIndex, dimensions, onOverlayChange]);

  // ─── Listen for snapshot request (export) ──────────────────────────────────
  useEffect(() => {
    const handler = () => {
      const fc = fabricRef.current;
      if (!fc || dimensions.width === 0) return;
      const dataUrl = fc.toDataURL({ format: 'png', multiplier: 1 });
      if (dataUrl === 'data:,') return;
      const currentJson = JSON.stringify(fc.toJSON());
      let parsed: Record<string, unknown> = {};
      try { parsed = JSON.parse(currentJson); } catch {}
      parsed.__dataUrl = dataUrl;
      const newJson = JSON.stringify(parsed);
      lastOverlayRef.current = newJson;
      onOverlayChange(pageIndex, newJson);
    };
    window.addEventListener('pdf-editor:request-snapshot', handler);
    return () => window.removeEventListener('pdf-editor:request-snapshot', handler);
  }, [pageIndex, dimensions, onOverlayChange]);

  // ─── Keyboard: Delete selected object ─────────────────────────────────────
  useEffect(() => {
    if (!isCurrentPage) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const fc = fabricRef.current;
        if (!fc) return;
        // Don't delete when a Fabric Textbox is in text-edit mode
        const activeObj = fc.getActiveObject();
        if (activeObj && (activeObj as fabric.Textbox).isEditing) return;
        const active = fc.getActiveObjects();
        if (active.length === 0) return;
        fc.remove(...active);
        fc.discardActiveObject();
        fc.renderAll();
        const json = JSON.stringify(fc.toJSON());
        lastOverlayRef.current = json;
        onOverlayChange(pageIndex, json);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isCurrentPage, pageIndex, onOverlayChange]);

  return (
    <div ref={containerRef} className="relative shadow-2xl" style={{ width: dimensions.width, height: dimensions.height }}>
      {/* Layer 1 — PDF page rendered as read-only canvas */}
      <canvas ref={pdfCanvasRef} className="absolute top-0 left-0" />

      {/* Layer 2 — Editable text spans from PDF text content (Adobe "Edit PDF" mode) */}
      {dimensions.width > 0 && (
        <TextEditLayer
          pageIndex={pageIndex}
          pdfBytes={pdfBytes}
          scale={scale}
          pageWidth={dimensions.width}
          pageHeight={dimensions.height}
          editMode={activeTool === 'editText'}
          textEdits={textEdits}
          onTextEdit={(blockId, text) => onTextEdit(pageIndex, blockId, text)}
        />
      )}

      {/* Layer 3 — Fabric.js annotation / drawing canvas (disabled in editText mode) */}
      <canvas
        ref={fabricCanvasRef}
        className="absolute top-0 left-0"
        style={{ pointerEvents: activeTool === 'editText' ? 'none' : 'all' }}
      />

      {/* Floating delete button — appears when a Fabric object is selected */}
      {selectionBounds && activeTool !== 'editText' && (
        <button
          title="Delete selected object"
          onMouseDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            const fc = fabricRef.current;
            if (!fc) return;
            const active = fc.getActiveObjects();
            if (active.length === 0) return;
            fc.remove(...active);
            fc.discardActiveObject();
            fc.renderAll();
            const json = JSON.stringify(fc.toJSON());
            lastOverlayRef.current = json;
            onOverlayChange(pageIndex, json);
            setSelectionBounds(null);
          }}
          style={{
            position: 'absolute',
            left: selectionBounds.left + selectionBounds.width - 4,
            top: Math.max(0, selectionBounds.top - 14),
            zIndex: 30,
          }}
          className="w-7 h-7 bg-red-500 hover:bg-red-600 text-white rounded-full flex items-center justify-center shadow-lg transition-colors"
        >
          <Trash2 size={13} />
        </button>
      )}
    </div>
  );
}
