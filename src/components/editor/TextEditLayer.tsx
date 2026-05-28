'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import type { TextItem } from 'pdfjs-dist/types/src/display/api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TextBlock {
  id: string;
  str: string;
  htmlStr: string;   // HTML with <b>/<i> tags preserving per-item formatting
  left: number;
  top: number;
  width: number;
  height: number;
  fontSize: number;
  fontFamily: string;
  angle: number;
  bold: boolean;
  italic: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function transformPoint(m: number[], x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
}

function detectBold(pdfName: string): boolean {
  return /bold/i.test(pdfName);
}

function detectItalic(pdfName: string): boolean {
  return /(italic|oblique)/i.test(pdfName);
}

/**
 * If a saved value is plain text (no bold/italic tags) but the original
 * block had HTML formatting, restore the formatting for the original portion.
 * Handles old plain-text saves made before the HTML-based save was implemented.
 */
function reattachFormatting(savedHtml: string, blockStr: string, htmlStr: string): string {
  // Already has formatting — use as-is
  if (/<(b|i|strong|em)(\s[^>]*)?>/i.test(savedHtml)) return savedHtml;
  // Block has no rich formatting — nothing to restore
  if (!/<(b|i|strong|em)(\s[^>]*)?>/i.test(htmlStr)) return savedHtml;
  // Plain-text save that starts with the original block content
  const trimOrig = blockStr.trim();
  const trimSaved = savedHtml.trim();
  if (trimSaved.startsWith(trimOrig)) {
    const suffix = savedHtml.slice(savedHtml.indexOf(trimOrig) + trimOrig.length);
    return htmlStr + suffix;
  }
  return savedHtml;
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

    // Build plain text AND HTML simultaneously, inserting spaces where gaps exist
    let combinedStr = '';
    let htmlStr = '';
    for (let i = 0; i < group.length; i++) {
      const curr = group[i];
      // Insert a space when a significant gap exists (space item was filtered out)
      if (i > 0) {
        const prev = group[i - 1];
        const gap = curr.sx - (prev.sx + prev.fontW);
        if (gap > prev.fontH * 0.15 && !combinedStr.endsWith(' ') && !curr.it.str.startsWith(' ')) {
          combinedStr += ' ';
          htmlStr += ' ';
        }
      }
      const bold = detectBold(curr.it.fontName ?? '');
      const italic = detectItalic(curr.it.fontName ?? '');
      const escaped = curr.it.str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      combinedStr += curr.it.str;
      if (bold && italic) htmlStr += `<b><i>${escaped}</i></b>`;
      else if (bold)   htmlStr += `<b>${escaped}</b>`;
      else if (italic) htmlStr += `<i>${escaped}</i>`;
      else             htmlStr += escaped;
    }

    return {
      id: `${pageIndex}-${gi}`,
      str: combinedStr,
      htmlStr,
      left: Math.min(...group.map((g) => g.sx)),
      top: first.sy - first.fontH,
      width: Math.max(last.sx + last.fontW - Math.min(...group.map((g) => g.sx)), first.fontH * 0.5),
      height: first.fontH * 1.5,
      fontSize: first.fontH,
      fontFamily: parseFontName(first.it.fontName),
      angle: first.angle,
      bold: detectBold(first.it.fontName ?? ''),
      italic: detectItalic(first.it.fontName ?? ''),
    };
  });
}

// Strip HTML tags to plain text (used when passing to PDF export)
export function htmlToPlainText(html: string): string {
  return html.replace(/<[^>]+>/g, '');
}

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
  // Refs so the populate-effect only re-runs on editingId change, not on every
  // textEdits/blocks update (which would overwrite the user's in-progress typing)
  const textEditsRef = useRef<Record<string, string>>(textEdits);
  const blocksRef = useRef<TextBlock[]>(blocks);
  useEffect(() => { textEditsRef.current = textEdits; }, [textEdits]);
  useEffect(() => { blocksRef.current = blocks; }, [blocks]);

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

  // When editingId changes, populate and focus the single editor div.
  // Deps: only editingId — textEdits/blocks are read via refs so they don't
  // accidentally overwrite the user's in-progress typed content.
  useEffect(() => {
    if (!editingId) return;
    const el = editorRef.current;
    if (!el) return;
    const block = blocksRef.current.find((b) => b.id === editingId);
    if (!block) return;
    const savedHtml = textEditsRef.current[editingId];
    // Reattach formatting if the saved value is a plain-text copy of the original
    const loadHtml = savedHtml !== undefined
      ? reattachFormatting(savedHtml, block.str, block.htmlStr)
      : block.htmlStr;
    el.innerHTML = loadHtml;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingId]); // ← intentionally excludes textEdits/blocks

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
    // Sanitize: strip browser-added div/span wrappers while keeping <b>/<i>
    const raw = editorRef.current.innerHTML ?? '';
    const cleaned = raw
      .replace(/<div>/gi, '<br>')
      .replace(/<\/div>/gi, '')
      .replace(/<span[^>]*>/gi, '')
      .replace(/<\/span>/gi, '')
      // Normalize browser's bold/italic wrappers to short tags
      .replace(/<strong>/gi, '<b>').replace(/<\/strong>/gi, '</b>')
      .replace(/<em>/gi, '<i>').replace(/<\/em>/gi, '</i>');
    // Don't save unless the user actually changed the text.
    // Compare plain-text content (HTML-stripped) against the original block str.
    const block = blocksRef.current.find((b) => b.id === editingId);
    const plainEdited = cleaned.replace(/<[^>]+>/g, '').trim();
    const plainOriginal = (block?.str ?? '').trim();
    const hadPreviousSave = textEditsRef.current[editingId] !== undefined;
    if (!hadPreviousSave && plainEdited === plainOriginal) {
      // User opened the block but didn't change anything — don't create an overlay
      setEditingId(null);
      return;
    }
    onTextEdit(editingId, cleaned);
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
      {/* ── Saved text edit overlays (always visible, cover original PDF text) ── */}
      {blocks.map((block) => {
        const editedText = textEdits[block.id];
        // Don't show overlay while the editor div is active for this block
        if (editedText === undefined || editingId === block.id) return null;
        // Skip overlay when the saved text is identical to the original (ghost save)
        const savedPlain = editedText.replace(/<[^>]+>/g, '').trim();
        if (savedPlain === block.str.trim()) return null;
        // Restore bold/italic from original htmlStr if the saved value was plain text
        const displayHtml = reattachFormatting(editedText, block.str, block.htmlStr);
        return (
          <div
            key={`savedEdit-${block.id}`}
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: displayHtml }}
            style={{
              position: 'absolute',
              left: block.left - 2,
              top: block.top - 1,
              minWidth: block.width + 4,
              height: block.height + 2,
              fontSize: block.fontSize,
              lineHeight: `${block.height + 2}px`,
              fontFamily: block.fontFamily,
              color: '#111111',
              background: 'white',
              whiteSpace: 'pre',
              overflow: 'visible',
              pointerEvents: 'none',
              zIndex: 1,
              padding: '0 2px',
              boxSizing: 'border-box',
            }}
          />
        );
      })}

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

      {/* ── Floating mini formatting bar (appears above the active editor) ── */}
      {editingBlock && (
        <div
          style={{
            position: 'absolute',
            left: editingBlock.left - 2,
            top: Math.max(4, editingBlock.top - 40),
            zIndex: 25,
            display: 'flex',
            alignItems: 'center',
            gap: 2,
            background: '#1e293b',
            border: '1px solid #334155',
            borderRadius: 6,
            padding: '3px 5px',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
            pointerEvents: 'all',
            userSelect: 'none',
          }}
        >
          <button
            onMouseDown={(e) => { e.preventDefault(); document.execCommand('bold'); }}
            className="w-7 h-7 rounded font-bold text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors flex items-center justify-center"
            title="Bold (Ctrl+B)"
          >B</button>
          <button
            onMouseDown={(e) => { e.preventDefault(); document.execCommand('italic'); }}
            className="w-7 h-7 rounded italic text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors flex items-center justify-center"
            title="Italic (Ctrl+I)"
          >I</button>
          <button
            onMouseDown={(e) => { e.preventDefault(); document.execCommand('underline'); }}
            className="w-7 h-7 rounded underline text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white transition-colors flex items-center justify-center"
            title="Underline (Ctrl+U)"
          >U</button>
          <div style={{ width: 1, height: 18, background: '#475569', margin: '0 2px' }} />
          <button
            onMouseDown={(e) => {
              e.preventDefault();
              document.execCommand('removeFormat');
            }}
            className="px-1.5 h-7 rounded text-xs text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors flex items-center justify-center"
            title="Clear formatting"
          >Clear</button>
        </div>
      )}

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
          // fontWeight/fontStyle intentionally omitted — <b>/<i> tags in innerHTML handle it
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
