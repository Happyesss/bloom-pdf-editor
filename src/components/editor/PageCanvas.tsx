'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as fabric from 'fabric';
import type { ToolType, ToolOptions } from '@/types/editor';

interface PageCanvasProps {
  pageIndex: number;       // 0-based
  pdfBytes: ArrayBuffer;
  scale: number;
  activeTool: ToolType;
  toolOptions: ToolOptions;
  overlayJson?: string;
  isCurrentPage: boolean;
  onOverlayChange: (pageIndex: number, json: string) => void;
  onHistoryPush: (pageIndex: number, json: string) => void;
}

export default function PageCanvas({
  pageIndex,
  pdfBytes,
  scale,
  activeTool,
  toolOptions,
  overlayJson,
  isCurrentPage,
  onOverlayChange,
  onHistoryPush,
}: PageCanvasProps) {
  const pdfCanvasRef = useRef<HTMLCanvasElement>(null);
  const fabricCanvasRef = useRef<HTMLCanvasElement>(null);
  const fabricRef = useRef<fabric.Canvas | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const isDrawingRef = useRef(false);
  const startPointRef = useRef<{ x: number; y: number } | null>(null);
  const activeShapeRef = useRef<fabric.Object | null>(null);
  const lastOverlayRef = useRef<string>('');

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

      const viewport = page.getViewport({ scale });
      const canvas = pdfCanvasRef.current;
      if (!canvas) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;
      setDimensions({ width: viewport.width, height: viewport.height });

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
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

    // Restore overlay if exists
    if (overlayJson) {
      try {
        const parsed = JSON.parse(overlayJson);
        fc.loadFromJSON(parsed, () => fc.renderAll());
      } catch {}
    }

    // Object modified → save
    const saveOverlay = () => {
      const json = JSON.stringify(fc.toJSON());
      if (json !== lastOverlayRef.current) {
        lastOverlayRef.current = json;
        onOverlayChange(pageIndex, json);
      }
    };

    fc.on('object:modified', saveOverlay);
    fc.on('object:added', saveOverlay);
    fc.on('object:removed', saveOverlay);

    return () => {
      fc.dispose();
      fabricRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dimensions]);

  // ─── Sync overlayJson from store into fabric (external changes, undo/redo) ─
  useEffect(() => {
    const fc = fabricRef.current;
    if (!fc || !overlayJson) return;
    if (overlayJson === lastOverlayRef.current) return;
    try {
      const parsed = JSON.parse(overlayJson);
      fc.loadFromJSON(parsed, () => fc.renderAll());
      lastOverlayRef.current = overlayJson;
    } catch {}
  }, [overlayJson]);

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
        const active = fc.getActiveObject();
        if (active && !(active as fabric.Textbox).isEditing) {
          fc.remove(active);
          fc.renderAll();
          const json = JSON.stringify(fc.toJSON());
          lastOverlayRef.current = json;
          onOverlayChange(pageIndex, json);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [isCurrentPage, pageIndex, onOverlayChange]);

  return (
    <div ref={containerRef} className="relative shadow-2xl" style={{ width: dimensions.width, height: dimensions.height }}>
      {/* PDF page rendered in background */}
      <canvas ref={pdfCanvasRef} className="absolute top-0 left-0" />
      {/* Fabric.js interactive overlay */}
      <canvas ref={fabricCanvasRef} className="absolute top-0 left-0" />
    </div>
  );
}
