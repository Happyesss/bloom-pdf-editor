'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TextBlock {
  id: string;
  str: string;
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  angle: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function transformPoint(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function parseFontName(pdfName: string): string {
  const base = pdfName
    .replace(/^[A-Z]{6}\+/, '')
    .replace(/-(Bold|Italic|Regular|Roman|Light|Medium)$/i, '');
  const map: Record<string, string> = {
    Arial: 'Arial, Helvetica, sans-serif',
    ArialMT: 'Arial, Helvetica, sans-serif',
    Helvetica: 'Helvetica, Arial, sans-serif',
    Times: 'Times New Roman, Times, serif',
    TimesNewRoman: '"Times New Roman", Times, serif',
    TimesNewRomanPSMT: '"Times New Roman", Times, serif',
    Courier: '"Courier New", Courier, monospace',
    CourierNew: '"Courier New", Courier, monospace',
    Georgia: 'Georgia, serif',
    Verdana: 'Verdana, sans-serif',
    Calibri: 'Calibri, sans-serif',
    Garamond: 'Garamond, serif',
    TrebuchetMS: '"Trebuchet MS", sans-serif',
  };
  for (const [key, val] of Object.entries(map)) {
    if (base.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return 'Arial, Helvetica, sans-serif';
}

function buildTextBlocks(
  items: TextItem[],
  scale: number,
  viewport: { transform: number[] },
  pageIndex: number,
): TextBlock[] {
  const vt = viewport.transform;

  const enriched = items
    .filter((it) => it.str.trim().length > 0)
    .map((it, idx) => {
      const [sx, sy] = transformPoint(vt, it.transform[4], it.transform[5]);
      const fontH =
        Math.abs(it.transform[3] * vt[3]) || Math.abs(it.transform[0] * vt[0]) || 12;
      const fontW = it.width * Math.abs(vt[0]);
      const angle = Math.atan2(it.transform[1], it.transform[0]) * (180 / Math.PI);
      return { it, sx, sy, fontH, fontW, angle, idx };
    })
    .sort((a, b) => {
      const dy = a.sy - b.sy;
      if (Math.abs(dy) > Math.min(a.fontH, b.fontH) * 0.6) return dy;
      return a.sx - b.sx;
    });

  const groups: (typeof enriched)[] = [];
  let cur: typeof enriched = [];
  for (const item of enriched) {
    if (cur.length === 0) {
      cur.push(item);
    } else {
      const last = cur[cur.length - 1];
      const sameBaseline =
        Math.abs(item.sy - last.sy) < Math.max(item.fontH, last.fontH) * 0.6;
      const sameFontSize = Math.abs(item.fontH - last.fontH) < 3;
      const horizontallyClose = item.sx <= last.sx + last.fontW + last.fontH * 2;
      if (sameBaseline && sameFontSize && horizontallyClose) {
        cur.push(item);
      } else {
        groups.push(cur);
        cur = [item];
      }
    }
  }
  if (cur.length > 0) groups.push(cur);

  return groups.map((group, gi): TextBlock => {
    const first = group[0];
    const last = group[group.length - 1];
    return {
      id: `${pageIndex}-${gi}`,
      str: group.map((g) => g.it.str).join(''),
      left: Math.min(...group.map((g) => g.sx)),
      top: first.sy - first.fontH,
      width: Math.max(last.sx + last.fontW - Math.min(...group.map((g) => g.sx)), first.fontH * 0.5),
      height: first.fontH * 1.5,
      fontSize: first.fontH,
      fontFamily: parseFontName(first.it.fontName),
      angle: first.angle,
    };
  });
}

// ─── Component ────────────────────────────────────────────────────────────────

interface TextEditLayerProps {
  pageIndex: number;
  pdfBytes: ArrayBuffer;
  scale: number;
  pageWidth: number;
  pageHeight: number;
  editMode: boolean;
  textEdits: Record<string, string>;
  onTextEdit: (blockId: string, text: string) => void;
  onBlocksReady?: (blocks: TextBlock[]) => void;
}

export default function TextEditLayer({
  pageIndex,
  pdfBytes,
  scale,
  pageWidth,
  pageHeight,
  editMode,
  textEdits,
  onTextEdit,
  onBlocksReady,
}: TextEditLayerProps) {
  const [blocks, setBlocks] = useState<TextBlock[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The ONE always-mounted contentEditable div — never toggled on existing nodes
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editMode) {
      setSelectedId(null);
      setEditingId(null);
    }
  }, [editMode]);

  useEffect(() => {
    let cancelled = false;
    async function extract() {
      const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist');
      GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      const pdf = await getDocument({ data: pdfBytes.slice(0) }).promise;
      if (cancelled) return;
      const page = await pdf.getPage(pageIndex + 1);
      if (cancelled) return;
      const viewport = page.getViewport({ scale });
      const textContent = await page.getTextContent();
      if (cancelled) return;
      const rawItems = textContent.items.filter((it): it is TextItem => 'str' in it);
      const built = buildTextBlocks(rawItems, scale, viewport, pageIndex);
      setBlocks(built);
      onBlocksReady?.(built);
    }
    extract().catch(console.error);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdfBytes, pageIndex, scale]);

  // When editingId changes, populate and focus the single editor div
  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    if (!editingId) return;
    const block = blocks.find((b) => b.id === editingId);
    if (!block) return;
    const text =
      textEdits[editingId] !== undefined ? textEdits[editingId] : block.str;
    el.innerText = text;
    el.focus();
    try {
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    } catch {
      // ignore
    }
  }, [editingId, blocks, textEdits]);

  const handleZoneClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!editMode) return;
      if (selectedId === id) {
        setEditingId(id);
      } else {
        setSelectedId(id);
        setEditingId(null);
      }
    },
    [editMode, selectedId],
  );

  const handleZoneDblClick = useCallback(
    (id: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (!editMode) return;
      setSelectedId(id);
      setEditingId(id);
    },
    [editMode],
  );

  const handleEditorBlur = useCallback(() => {
    if (!editingId || !editorRef.current) return;
    const text = editorRef.current.innerText ?? '';
    onTextEdit(editingId, text);
    setEditingId(null);
  }, [editingId, onTextEdit]);

  const handleEditorKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      editorRef.current?.blur();
    }
    e.stopPropagation();
  }, []);

  const editingBlock = blocks.find((b) => b.id === editingId) ?? null;

  return (
    <div
      className="absolute inset-0 pointer-events-none"
      style={{ width: pageWidth, height: pageHeight }}
    >
      {/* ── Plain (non-editable) hit zones ──────────────────────────── */}
      {blocks.map((block) => {
        const isSelected = selectedId === block.id;
        const hasEdit = textEdits[block.id] !== undefined;
        const isBeingEdited = editingId === block.id;
        return (
          <div
            key={block.id}
            onClick={(e) => handleZoneClick(block.id, e)}
            onDoubleClick={(e) => handleZoneDblClick(block.id, e)}
            style={{
              position: 'absolute',
              left: block.left,
              top: block.top,
              width: block.width,
              height: block.height,
              cursor: editMode ? 'text' : 'default',
              // Hide behind the editor div when editing this block
              pointerEvents: editMode && !isBeingEdited ? 'all' : 'none',
              background: isSelected && !isBeingEdited
                ? 'rgba(59,130,246,0.08)'
                : 'transparent',
              // Use individual border sides — never mix shorthand + longhand
              borderTop: isSelected && !isBeingEdited ? '1.5px dashed #2563eb' : 'none',
              borderLeft: isSelected && !isBeingEdited ? '1.5px dashed #2563eb' : 'none',
              borderRight: isSelected && !isBeingEdited ? '1.5px dashed #2563eb' : 'none',
              borderBottom: isSelected && !isBeingEdited
                ? '1.5px dashed #2563eb'
                : hasEdit && !isBeingEdited
                ? '2px dotted #2563eb'
                : 'none',
              borderRadius: 2,
              boxSizing: 'border-box',
              zIndex: 2,
            }}
          />
        );
      })}

      {/* ── Hover-highlight strips (CSS-only, no conditional list) ── */}
      {blocks.map((block) => (
        <div
          key={`hl-${block.id}`}
          onClick={(e) => handleZoneClick(block.id, e)}
          onDoubleClick={(e) => handleZoneDblClick(block.id, e)}
          style={{
            position: 'absolute',
            left: block.left - 2,
            top: block.top - 1,
            width: block.width + 4,
            height: block.height + 2,
            cursor: 'text',
            // only interactive in editMode and not currently editing this block
            pointerEvents:
              editMode && editingId !== block.id ? 'all' : 'none',
            opacity: editMode && editingId !== block.id ? 1 : 0,
            zIndex: 1,
          }}
          className="group"
        >
          <div
            className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity rounded"
            style={{
              background: 'rgba(59,130,246,0.06)',
              border: '1px solid rgba(59,130,246,0.25)',
            }}
          />
        </div>
      ))}

      {/* ── Single always-mounted contentEditable div ─────────────── */}
      {/* NEVER toggle contentEditable on an existing node — that crashes React */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onBlur={handleEditorBlur}
        onKeyDown={handleEditorKeyDown}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          left: editingBlock?.left ?? 0,
          top: editingBlock?.top ?? 0,
          minWidth: editingBlock?.width ?? 0,
          height: editingBlock?.height ?? 0,
          fontSize: editingBlock?.fontSize ?? 14,
          lineHeight: editingBlock ? `${editingBlock.height}px` : '1',
          fontFamily: editingBlock?.fontFamily ?? 'Arial, sans-serif',
          transform:
            editingBlock && editingBlock.angle !== 0
              ? `rotate(${editingBlock.angle}deg)`
              : undefined,
          transformOrigin: 'left top',
          color: '#111111',
          caretColor: '#2563eb',
          background: 'rgba(255,255,255,0.97)',
          border: '2px solid #2563eb',
          borderRadius: 2,
          padding: '0 2px',
          boxShadow: editingBlock ? '0 4px 24px rgba(37,99,235,0.15)' : 'none',
          outline: 'none',
          whiteSpace: 'pre',
          overflow: 'visible',
          boxSizing: 'border-box',
          // Hidden when not editing — but the node stays in the DOM
          visibility: editingBlock ? 'visible' : 'hidden',
          pointerEvents: editingBlock ? 'all' : 'none',
          zIndex: 20,
        }}
      />
    </div>
  );
}
