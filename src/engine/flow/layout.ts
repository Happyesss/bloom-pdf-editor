/**
 * Paragraph layout — wrap overflow, cascade line text, and compute position shifts.
 */

import type { TextRun } from '../content/interpreter';
import type { DocumentFlow, Paragraph, TextLine } from './types';
import { greedyWrap } from './line-break';
import { estimateTextWidth } from './metrics';
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

  const segmentEdits = distributeTextToSegments(line, newText);
  const shifts: RunShift[] = [];

  for (let i = 0; i < line.segments.length; i++) {
    const seg = line.segments[i];
    const edit = segmentEdits.find(e => e.run === seg.run);
    const oldW = estimateTextWidth(seg.text, seg.run);
    const newW = estimateTextWidth(edit?.newText ?? seg.text, seg.run);
    const segDelta = newW - oldW;
    if (Math.abs(segDelta) < 0.01) continue;

    for (let j = i + 1; j < line.segments.length; j++) {
      shifts.push({ run: line.segments[j].run, dx: segDelta, dy: 0 });
    }
  }

  return mergeShifts(shifts);
}

/**
 * Build a layout plan for editing one line inside a paragraph.
 * Handles word wrap, overflow cascade, horizontal run shifts, and vertical push-down.
 */
export function computeLayoutPlan(
  paragraph: Paragraph,
  editedLine: TextLine,
  newText: string,
): LayoutPlan {
  const lineIndex = paragraph.lines.findIndex(l => l.id === editedLine.id);
  if (lineIndex < 0) {
    return {
      lineEdits: [{ line: editedLine, newText }],
      shifts: computeHorizontalShifts(editedLine, newText),
      previewLines: [newText],
    };
  }

  const maxWidth = Math.max(
    editedLine.width,
    editedLine.rightEdge - editedLine.leftMargin,
    paragraph.width * 0.5,
  );
  const measure = lineMeasureWidth(editedLine);
  const chunks = greedyWrap(newText, maxWidth, measure);
  const lineEdits: LineTextEdit[] = [{ line: editedLine, newText: chunks[0] }];
  const shifts: RunShift[] = computeHorizontalShifts(editedLine, chunks[0]);

  if (chunks.length > 1) {
    const lineHeight = computeLineHeight(editedLine);
    const overflowLines = chunks.slice(1);
    const originalTail = paragraph.lines.slice(lineIndex + 1).map(l => l.text);

    for (let i = 0; i < overflowLines.length; i++) {
      const targetIndex = lineIndex + 1 + i;
      const displaced = originalTail[i] ?? '';
      const merged = displaced
        ? `${overflowLines[i]} ${displaced}`
        : overflowLines[i];

      if (targetIndex < paragraph.lines.length) {
        lineEdits.push({ line: paragraph.lines[targetIndex], newText: merged });
      }
    }

    const pushLines = overflowLines.length;
    const shiftDy = -pushLines * lineHeight;
    for (let i = lineIndex + 1; i < paragraph.lines.length; i++) {
      const affected = paragraph.lines[i];
      for (let r = 0; r < affected.runs.length; r++) {
        shifts.push({ run: affected.runs[r], dx: 0, dy: shiftDy });
      }
    }
  }

  return {
    lineEdits,
    shifts: mergeShifts(shifts),
    previewLines: chunks,
  };
}

/** Preview layout for the edit overlay without touching the PDF. */
export function computeEditPreview(
  flow: DocumentFlow | undefined,
  line: TextLine,
  newText: string,
): string[] {
  if (!flow) {
    const maxWidth = line.rightEdge - line.leftMargin;
    return greedyWrap(newText, maxWidth, lineMeasureWidth(line));
  }

  const para = findParagraphForLine(flow, line);
  if (!para) {
    const maxWidth = line.rightEdge - line.leftMargin;
    return greedyWrap(newText, maxWidth, lineMeasureWidth(line));
  }

  return computeLayoutPlan(para, line, newText).previewLines;
}
