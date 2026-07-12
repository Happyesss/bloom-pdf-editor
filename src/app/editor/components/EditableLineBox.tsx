'use client';

import React, { useCallback, useLayoutEffect, useRef, useState } from 'react';

/** One styled fragment inside the line editor (mirrors PDF runs). */
export interface OverlaySegmentStyle {
  text: string;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  underline: boolean;
  color: string;
}

export interface EditableLineBoxProps {
  left: number;
  top: number;
  /** Natural content width at current scale (PDF glyph span in CSS px). */
  naturalWidth: number;
  /** Natural content height at current scale (matches on-canvas font size). */
  naturalHeight: number;
  fontSizeCss: number;
  /** Fallback single-style props when segments are empty. */
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  underline?: boolean;
  color: string;
  /** Per-run styles so mixed bold/underline render like the PDF. */
  segments?: OverlaySegmentStyle[];
  text: string;
  textRef: React.RefObject<HTMLTextAreaElement | null>;
  onTextInput: (e: React.FormEvent<HTMLTextAreaElement>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onSelect?: (start: number, end: number) => void;
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
 * Framed line editor: stays at PDF size/position, drag to move, handles to resize.
 * Renders per-segment styles under a transparent textarea so mixed bold/underline
 * match the canvas; applies horizontal stretch like the PDF renderer.
 */
export function EditableLineBox(props: EditableLineBoxProps) {
  const {
    left, top, naturalWidth, naturalHeight,
    fontSizeCss, fontFamily, fontWeight, fontStyle, underline, color,
    segments, text, textRef, onTextInput, onKeyDown, onSelect, onBlur,
    onOffsetChange, onSizeChange,
    offsetCssX, offsetCssY, manualWidth, manualHeight,
  } = props;

  const [autoWidth, setAutoWidth] = useState(naturalWidth);
  const [scaleX, setScaleX] = useState(1);
  const measureRef = useRef<HTMLSpanElement>(null);
  const dragMode = useRef<DragMode>(null);
  const dragStart = useRef({ x: 0, y: 0, ox: 0, oy: 0, w: 0, h: 0 });
  const frozenScaleX = useRef<number | null>(null);
  const sessionKeyRef = useRef(`${left},${top},${naturalWidth},${naturalHeight}`);

  const hasSegments = !!(segments && segments.length > 0);
  const caretColor = hasSegments
    ? (segments.find(s => s.text.length > 0)?.color || color)
    : color;

  // Match PDF glyph width like the canvas renderer (ctx.scale(ratio, 1)).
  useLayoutEffect(() => {
    const sessionKey = `${left},${top},${naturalWidth},${naturalHeight}`;
    if (sessionKeyRef.current !== sessionKey) {
      sessionKeyRef.current = sessionKey;
      frozenScaleX.current = null;
    }

    const el = measureRef.current;
    if (!el) return;
    const measured = el.offsetWidth;
    if (measured < 0.5 || naturalWidth < 0.5) {
      setAutoWidth(Math.max(naturalWidth, 40));
      return;
    }

    if (frozenScaleX.current == null) {
      const ratio = naturalWidth / measured;
      frozenScaleX.current = Math.max(0.55, Math.min(1.85, ratio));
    }
    const sx = frozenScaleX.current;
    setScaleX(Math.abs(sx - 1) > 0.005 ? sx : 1);

    const contentCss = measured * sx;
    const grown = Math.ceil(Math.max(naturalWidth, contentCss));
    setAutoWidth(Math.max(grown, 40));
  }, [text, fontSizeCss, fontFamily, fontWeight, fontStyle, segments, naturalWidth, naturalHeight, left, top]);

  const width = manualWidth ?? Math.max(autoWidth, naturalWidth);
  const height = manualHeight ?? naturalHeight;

  const reportSelection = useCallback((el: HTMLTextAreaElement) => {
    onSelect?.(el.selectionStart ?? 0, el.selectionEnd ?? 0);
  }, [onSelect]);

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

  const stretchStyle: React.CSSProperties = {
    transform: scaleX !== 1 ? `scaleX(${scaleX})` : undefined,
    transformOrigin: 'left center',
    width: scaleX !== 1 && scaleX > 0 ? `${100 / scaleX}%` : '100%',
  };

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
      {/* Hidden measure row — mirrors visible segment metrics for scaleX */}
      <span
        ref={measureRef}
        aria-hidden
        className="absolute opacity-0 pointer-events-none whitespace-pre"
        style={{
          fontSize: fontSizeCss,
          lineHeight: 1,
          left: -9999,
          top: 0,
        }}
      >
        {hasSegments
          ? segments!.map((seg, i) => (
              <span
                key={i}
                style={{
                  fontFamily: seg.fontFamily,
                  fontWeight: seg.fontWeight,
                  fontStyle: seg.fontStyle,
                }}
              >
                {seg.text || ''}
              </span>
            ))
          : (
              <span style={{ fontFamily, fontWeight, fontStyle }}>{text || ' '}</span>
            )}
      </span>

      {/* Selection chrome */}
      <div
        className="absolute inset-0 border border-dashed border-blue-500 rounded-sm pointer-events-none"
        style={{ boxShadow: '0 0 0 1px rgba(59,130,246,0.25)' }}
      />

      {/* Move hit targets */}
      <div
        className="absolute -top-2 -left-2 -right-2 h-4 cursor-grab active:cursor-grabbing z-30"
        onPointerDown={(e) => startDrag('move', e)}
        title="Drag to move"
      />
      <div
        className="absolute -bottom-2 -left-2 -right-2 h-4 cursor-grab active:cursor-grabbing z-30"
        onPointerDown={(e) => {
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

      {/* Visible mixed-style text (textarea is transparent for caret/IME only) */}
      {hasSegments && (
        <div
          aria-hidden
          className="absolute inset-0 m-0 p-0 overflow-hidden whitespace-nowrap pointer-events-none"
          style={{
            fontSize: fontSizeCss,
            lineHeight: `${fontSizeCss}px`,
            ...stretchStyle,
          }}
        >
          {segments!.map((seg, i) => (
            <span
              key={i}
              style={{
                fontFamily: seg.fontFamily,
                fontWeight: seg.fontWeight,
                fontStyle: seg.fontStyle,
                color: seg.color,
                textDecoration: seg.underline ? 'underline' : 'none',
                textDecorationColor: seg.color,
              }}
            >
              {seg.text}
            </span>
          ))}
        </div>
      )}

      <textarea
        ref={textRef as React.RefObject<HTMLTextAreaElement>}
        value={text}
        onInput={(e) => {
          onTextInput(e);
          reportSelection(e.currentTarget);
        }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => reportSelection(e.currentTarget)}
        onSelect={(e) => reportSelection(e.currentTarget)}
        onMouseUp={(e) => reportSelection(e.currentTarget)}
        onBlur={onBlur}
        rows={1}
        aria-label="Edit line"
        spellCheck={false}
        className="absolute inset-0 m-0 border-none outline-none bg-transparent p-0 overflow-hidden resize-none whitespace-nowrap z-10"
        style={{
          fontSize: fontSizeCss,
          lineHeight: `${fontSizeCss}px`,
          fontFamily,
          fontWeight,
          fontStyle,
          // Transparent text when segments paint styles; caret stays visible
          color: hasSegments ? 'transparent' : color,
          caretColor,
          textDecoration: hasSegments ? 'none' : (underline ? 'underline' : 'none'),
          ...stretchStyle,
        }}
        onPointerDown={(e) => {
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
