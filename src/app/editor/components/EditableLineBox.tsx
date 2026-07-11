'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';

export interface EditableLineBoxProps {
  left: number;
  top: number;
  /** Natural content width at current scale (auto-grow baseline). */
  naturalWidth: number;
  /** Natural content height at current scale. */
  naturalHeight: number;
  fontSizeCss: number;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  underline?: boolean;
  color: string;
  text: string;
  textRef: React.RefObject<HTMLTextAreaElement | null>;
  onTextInput: (e: React.FormEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onBlur: () => void;
  /** Called when the box is moved (delta in CSS pixels from session start). */
  onOffsetChange: (cssDx: number, cssDy: number) => void;
  /** Called when the user manually resizes (CSS px). */
  onSizeChange: (width: number, height: number) => void;
  /** Current drag offset from original position (CSS px). */
  offsetCssX: number;
  offsetCssY: number;
  /** Manual size override (CSS px); null = auto from content. */
  manualWidth: number | null;
  manualHeight: number | null;
}

type DragMode = 'move' | 'resize-e' | 'resize-s' | 'resize-se' | null;

/**
 * Framed line editor: auto-grows with text, drag to move, handles to resize.
 */
export function EditableLineBox(props: EditableLineBoxProps) {
  const {
    left, top, naturalWidth, naturalHeight,
    fontSizeCss, fontFamily, fontWeight, fontStyle, underline, color,
    text, textRef, onTextInput, onKeyDown, onBlur,
    onOffsetChange, onSizeChange,
    offsetCssX, offsetCssY, manualWidth, manualHeight,
  } = props;

  const [autoWidth, setAutoWidth] = useState(naturalWidth);
  const measureRef = useRef<HTMLSpanElement>(null);
  const dragMode = useRef<DragMode>(null);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0, w: 0, h: 0 });

  // Measure typed text and grow the box
  useEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    const measured = Math.ceil(el.offsetWidth + fontSizeCss * 0.4);
    setAutoWidth(Math.max(naturalWidth, measured, 40));
  }, [text, fontSizeCss, fontFamily, fontWeight, fontStyle, naturalWidth]);

  const width = manualWidth ?? Math.max(autoWidth, naturalWidth);
  const height = manualHeight ?? Math.max(naturalHeight, fontSizeCss * 1.2);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const mode = dragMode.current;
    if (!mode) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;

    if (mode === 'move') {
      onOffsetChange(dragStart.current.ox + dx, dragStart.current.oy + dy);
    } else if (mode === 'resize-e') {
      onSizeChange(Math.max(40, dragStart.current.w + dx), height);
    } else if (mode === 'resize-s') {
      onSizeChange(width, Math.max(fontSizeCss, dragStart.current.h + dy));
    } else if (mode === 'resize-se') {
      onSizeChange(
        Math.max(40, dragStart.current.w + dx),
        Math.max(fontSizeCss, dragStart.current.h + dy),
      );
    }
  }, [onOffsetChange, onSizeChange, width, height, fontSizeCss]);

  const endDrag = useCallback(() => {
    dragMode.current = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', endDrag);
  }, [onPointerMove]);

  const startDrag = useCallback((mode: DragMode, e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragMode.current = mode;
    dragStart.current = {
      x: e.clientX,
      y: e.clientY,
      ox: offsetCssX,
      oy: offsetCssY,
      w: width,
      h: height,
    };
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', endDrag);
  }, [offsetCssX, offsetCssY, width, height, onPointerMove, endDrag]);

  return (
    <div
      className="absolute z-20"
      style={{
        left: left + offsetCssX,
        top: top + offsetCssY,
        width,
        height,
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Hidden measure span for auto-width */}
      <span
        ref={measureRef}
        aria-hidden
        className="absolute opacity-0 pointer-events-none whitespace-pre"
        style={{
          fontSize: fontSizeCss,
          fontFamily,
          fontWeight,
          fontStyle,
          left: -9999,
          top: 0,
        }}
      >
        {text || ' '}
      </span>

      {/* Drag chrome — edges move the box */}
      <div
        className="absolute -inset-1 border border-dashed border-blue-500 rounded-sm pointer-events-none"
        style={{ boxShadow: '0 0 0 1px rgba(59,130,246,0.25)' }}
      />

      {/* Move hit targets around the frame */}
      <div
        className="absolute -top-2 -left-2 -right-2 h-4 cursor-grab active:cursor-grabbing z-30"
        onPointerDown={(e) => startDrag('move', e)}
        title="Drag to move"
      />
      <div
        className="absolute -bottom-2 -left-2 -right-2 h-4 cursor-grab active:cursor-grabbing z-30"
        onPointerDown={(e) => {
          // Don't steal SE resize corner
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
          if (e.clientX > rect.right - 16) return;
          startDrag('move', e);
        }}
        title="Drag to move"
      />
      <div
        className="absolute -left-2 top-2 bottom-2 w-4 cursor-grab active:cursor-grabbing z-30"
        onPointerDown={(e) => startDrag('move', e)}
        title="Drag to move"
      />
      <div
        className="absolute -top-3 left-1/2 -translate-x-1/2 px-2 py-0.5 bg-blue-500 text-white text-[9px] rounded-sm cursor-grab active:cursor-grabbing z-40 select-none whitespace-nowrap"
        onPointerDown={(e) => startDrag('move', e)}
      >
        Drag
      </div>

      <textarea
        ref={textRef as React.RefObject<HTMLTextAreaElement>}
        value={text}
        onInput={onTextInput}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        rows={1}
        aria-label="Edit line"
        spellCheck={false}
        className="absolute inset-0 m-0 border-none outline-none bg-transparent p-0 overflow-hidden resize-none whitespace-nowrap"
        style={{
          fontSize: fontSizeCss,
          lineHeight: `${fontSizeCss * 1.15}px`,
          fontFamily,
          fontWeight,
          fontStyle,
          color,
          caretColor: color,
          textDecoration: underline ? 'underline' : 'none',
        }}
        onPointerDown={(e) => {
          // Allow text selection; Alt/Meta+drag moves the box
          if (e.altKey || e.metaKey) startDrag('move', e);
          else e.stopPropagation();
        }}
      />

      {/* Resize handles */}
      <div
        className="absolute top-0 -right-1.5 w-3 h-full cursor-ew-resize z-30"
        onPointerDown={(e) => startDrag('resize-e', e)}
        title="Resize width"
      />
      <div
        className="absolute -bottom-1.5 left-0 h-3 w-full cursor-ns-resize z-30"
        onPointerDown={(e) => startDrag('resize-s', e)}
        title="Resize height"
      />
      <div
        className="absolute -right-1.5 -bottom-1.5 w-3.5 h-3.5 bg-blue-500 border-2 border-white rounded-sm cursor-se-resize z-40 shadow"
        onPointerDown={(e) => startDrag('resize-se', e)}
        title="Resize"
      />
    </div>
  );
}
