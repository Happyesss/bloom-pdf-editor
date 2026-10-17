'use client';

import React, { useEffect, useRef } from 'react';

export type LinkPopoverMode = 'hover' | 'edit';

export interface LinkPopoverProps {
  mode: LinkPopoverMode;
  /** CSS center-X of the link rect. */
  anchorX: number;
  /** CSS bottom-Y of the link rect (popover sits below). */
  anchorY: number;
  url: string;
  displayText: string;
  onUrlChange?: (url: string) => void;
  onDisplayChange?: (text: string) => void;
  onEdit: () => void;
  onOpen: () => void;
  onRemove: () => void;
  onClose?: () => void;
  onPopoverEnter?: () => void;
  onPopoverLeave?: () => void;
}

/**
 * Acrobat/Sejda-style link popovers over the PDF page.
 * Hover: URL + Edit + Open Link
 * Edit: Display / Link to / Link + Remove + Open Link
 */
export function LinkPopover({
  mode,
  anchorX,
  anchorY,
  url,
  displayText,
  onUrlChange,
  onDisplayChange,
  onEdit,
  onOpen,
  onRemove,
  onClose,
  onPopoverEnter,
  onPopoverLeave,
}: LinkPopoverProps) {
  const displayRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (mode === 'edit') {
      displayRef.current?.focus();
      displayRef.current?.select();
    }
  }, [mode]);

  return (
    <div
      className="absolute z-50"
      data-link-popover
      style={{ left: anchorX, top: anchorY, transform: 'translateX(-50%)' }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onMouseEnter={onPopoverEnter}
      onMouseLeave={onPopoverLeave}
    >
      {/* Invisible bridge so the pointer can travel from the link into the popover */}
      <div className="h-3 w-full" aria-hidden />

      {/* Caret pointer */}
      <div
        className="absolute top-1.5 left-1/2 -translate-x-1/2 w-3 h-3 rotate-45 bg-popover border-l border-t border-border"
        aria-hidden
      />

      {mode === 'hover' ? (
        <div className="relative bg-popover rounded-xl shadow-lg border border-border p-2.5 min-w-[220px] max-w-[320px]">
          <div className="bg-muted rounded-lg px-3 py-2 text-[12px] text-foreground font-mono truncate mb-2">
            {url || '(empty URL)'}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onEdit}
              className="flex-1 py-2 rounded-lg bg-muted hover:bg-border text-foreground text-[12px] font-semibold transition-colors"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onOpen}
              className="flex-1 py-2 rounded-lg bg-primary hover:brightness-105 text-white text-[12px] font-semibold transition-colors"
            >
              Open Link
            </button>
          </div>
        </div>
      ) : (
        <div className="relative bg-muted rounded-xl shadow-lg border border-border p-3 w-[280px]">
          <div className="space-y-2.5">
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <span className="w-14 shrink-0">Display:</span>
              <input
                ref={displayRef}
                type="text"
                value={displayText}
                onChange={(e) => onDisplayChange?.(e.target.value)}
                className="flex-1 min-w-0 rounded-md border-2 border-primary bg-card px-2 py-1 text-[12px] text-foreground outline-none"
              />
            </label>
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <span className="w-14 shrink-0">Link to:</span>
              <div className="flex-1 flex items-center rounded-md border border-border bg-card px-2 py-1 text-[12px] text-foreground">
                <span className="flex-1">Web page</span>
                <span className="ml-1 w-5 h-5 rounded bg-primary text-white text-[10px] flex items-center justify-center">↕</span>
              </div>
            </label>
            <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
              <span className="w-14 shrink-0">Link:</span>
              <input
                type="url"
                value={url}
                onChange={(e) => onUrlChange?.(e.target.value)}
                className="flex-1 min-w-0 rounded-md border border-border bg-card px-2 py-1 text-[12px] text-foreground outline-none focus:border-primary"
              />
            </label>
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                onClick={onRemove}
                className="flex-1 py-2 rounded-lg bg-border hover:bg-border-strong text-foreground text-[12px] font-semibold transition-colors"
              >
                Remove
              </button>
              <button
                type="button"
                onClick={onOpen}
                className="flex-1 py-2 rounded-lg bg-border hover:bg-border-strong text-foreground text-[12px] font-semibold transition-colors"
              >
                Open Link
              </button>
            </div>
          </div>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-muted-foreground text-background text-[10px] leading-none hover:bg-foreground"
              aria-label="Close"
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  );
}
