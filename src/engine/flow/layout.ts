/**
 * Paragraph layout — wrap overflow carefully so edits don't destroy neighboring lines.
 *
 * Critical rules (Acrobat-safe):
 * 1. Prefer editing only the current line.
 * 2. Never merge overflow text into the next line's existing content.
 * 3. Only push subsequent lines down when wrap creates NEW lines that fit
 *    in empty paragraph slots — never overwrite headings below.
 * 4. Use greedy wrap (predictable); Knuth-Plass is for preview only.
 */

import type { TextRun } from '../content/interpreter';
import type { DocumentFlow, Paragraph, TextLine } from './types';
import { greedyWrap } from './line-break';
import { estimateTextWidth, getRunBounds, visualFontSize } from './metrics';
import { distributeTextToSegments } from './reflow';

export interface LineTextEdit {
  line: TextLine;
  newText: string;
}

export interface RunShift {
  run: TextRun;
  dx: number;
  dy: number;
}

export interface LayoutPlan {
  lineEdits: LineTextEdit[];
  shifts: RunShift[];
  /** Wrapped lines for live preview (may be a single line). */
  previewLines: string[];
}

export function findParagraphForLine(flow: DocumentFlow, line: TextLine): Paragraph | null {
  for (let i = 0; i < flow.paragraphs.length; i++) {
    const para = flow.paragraphs[i];
    for (let j = 0; j < para.lines.length; j++) {
      if (para.lines[j].id === line.id) return para;
    }
  }
  return null;
}

export function computeLineHeight(line: TextLine): number {
  return Math.max(line.height, line.fontSize * 1.2, 12);
}

function lineMeasureWidth(line: TextLine): (segment: string) => number {
  const run = line.runs[0];
  if (!run) return (s: string) => s.length * line.fontSize * 0.5;
  return (s: string) => estimateTextWidth(s, run);
}

function mergeShifts(shifts: RunShift[]): RunShift[] {
  const map = new Map<TextRun, { dx: number; dy: number }>();
  for (let i = 0; i < shifts.length; i++) {
    const s = shifts[i];
    const prev = map.get(s.run) ?? { dx: 0, dy: 0 };
    prev.dx += s.dx;
    prev.dy += s.dy;
    map.set(s.run, prev);
  }

  const merged: RunShift[] = [];
  map.forEach((delta, run) => {
    if (Math.abs(delta.dx) > 0.01 || Math.abs(delta.dy) > 0.01) {
      merged.push({ run, dx: delta.dx, dy: delta.dy });
    }
  });
  return merged;
}

/** Shift trailing runs when an earlier segment grows or shrinks. */
export function computeHorizontalShifts(line: TextLine, newText: string): RunShift[] {
  if (line.segments.length <= 1) return [];
  return computeHorizontalShiftsFromEdits(line, distributeTextToSegments(line, newText));
}

/**
 * Recompute each segment's dx from a left-to-right chain:
 *   nextX = prevX + newWidth(prev) + originalGap
 * Cumulative delta shifts (old approach) under-estimate growth on condensed
 * resume fonts / Helvetica fallback, so trailing styled runs pile onto the
 * edited mid-line text.
 */
export function computeHorizontalShiftsFromEdits(
  line: TextLine,
  segmentEdits: { run: TextRun; newText: string }[],
): RunShift[] {
  if (line.segments.length <= 1) return [];

  const shifts: RunShift[] = [];
  let cursor = getRunBounds(line.segments[0].run).left;

  for (let i = 0; i < line.segments.length; i++) {
    const seg = line.segments[i];
    const run = seg.run;
    const edit = segmentEdits.find(e => e.run === run) ?? segmentEdits[i];
    const newText = edit?.newText ?? seg.text;
    const bounds = getRunBounds(run);
    const oldW = Math.max(bounds.width, estimateTextWidth(seg.text, run), 0.01);
    const estimated = estimateTextWidth(newText, run);
    const scaled = oldW * (newText.length / Math.max(1, seg.text.length));
    const fs = visualFontSize(run);
    // When growing, never assume narrower-than-Helvetica advance — subset fonts
    // often report tight averages that under-shift trailing runs.
    const growFloor = newText.length > seg.text.length
      ? newText.length * fs * 0.5
      : 0;
    const newW = Math.max(estimated, scaled, growFloor);

    const dx = cursor - bounds.left;
    if (Math.abs(dx) > 0.01) {
      shifts.push({ run, dx, dy: 0 });
    }

    let gap = 0;
    if (i < line.segments.length - 1) {
      const nextBounds = getRunBounds(line.segments[i + 1].run);
      gap = nextBounds.left - bounds.right;
      if (gap < 0) gap = fs * 0.12;
    }
    cursor += newW + gap;
  }

  return mergeShifts(shifts);
}

/**
 * Safe line measure width: prefer the visual line width, fall back to
 * rightEdge − leftMargin, never use a tiny paragraph.width*0.5 that
 * falsely wraps headings.
 */
function resolveMaxWidth(editedLine: TextLine, paragraph: Paragraph | null): number {
  const fromLine = editedLine.rightEdge - editedLine.leftMargin;
  const fromWidth = editedLine.width;
  const fromPara = paragraph ? paragraph.width : 0;
  // Use the largest plausible measure so we don't wrap prematurely
  const w = Math.max(fromLine, fromWidth, fromPara * 0.85, editedLine.fontSize * 8);
  // Guard against absurdly small widths
  return Math.max(w, editedLine.fontSize * 4);
}

/**
 * Build a layout plan for editing one line.
 *
 * Position-preserving v1: ALWAYS commit only the edited line.
 * Never cascade into neighbors (that destroyed resume headings).
 * Preview may still show wrap for the overlay.
 */
export function computeLayoutPlan(
  paragraph: Paragraph,
  editedLine: TextLine,
  newText: string,
): LayoutPlan {
  const maxWidth = resolveMaxWidth(editedLine, paragraph);
  const measure = lineMeasureWidth(editedLine);
  const natural = measure(newText);
  const previewLines =
    natural <= maxWidth * 1.05 ? [newText] : greedyWrap(newText, maxWidth, measure);

  return {
    lineEdits: [{ line: editedLine, newText }],
    shifts: computeHorizontalShifts(editedLine, newText),
    previewLines,
  };
}

/** Preview layout for the edit overlay without touching the PDF. */
export function computeEditPreview(
  flow: DocumentFlow | undefined,
  line: TextLine,
  newText: string,
): string[] {
  const maxWidth = resolveMaxWidth(line, flow ? findParagraphForLine(flow, line) : null);
  const measure = lineMeasureWidth(line);
  if (measure(newText) <= maxWidth * 1.05) return [newText];
  return greedyWrap(newText, maxWidth, measure);
}
