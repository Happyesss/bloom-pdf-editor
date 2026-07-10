/**
 * Flow-aware text editing — commit full-line edits across styled runs.
 */

import type { PDFObject, PDFPageInfo } from '../types';
import { applyTextEdits, applyRunPositionShifts, type EditResult, type TextEdit } from '../editor/text-editor';
import { distributeTextToSegments } from './reflow';
import {
  computeLayoutPlan,
  computeHorizontalShifts,
  findParagraphForLine,
  type LayoutPlan,
} from './layout';
import type { DocumentFlow, TextLine } from './types';

function buildLayoutPlan(
  flow: DocumentFlow | undefined,
  line: TextLine,
  newText: string,
): LayoutPlan {
  if (flow) {
    const paragraph = findParagraphForLine(flow, line);
    if (paragraph) {
      return computeLayoutPlan(paragraph, line, newText);
    }
  }

  return {
    lineEdits: [{ line, newText }],
    shifts: computeHorizontalShifts(line, newText),
    previewLines: [newText],
  };
}

/**
 * Apply a Word-style line edit with paragraph layout:
 * distributes text across styled runs, wraps overflow, and shifts positions.
 */
export function applyLineTextEdit(
  contentBytes: Uint8Array,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
  line: TextLine,
  newText: string,
  flow?: DocumentFlow,
): EditResult {
  const plan = buildLayoutPlan(flow, line, newText);
  const edits: TextEdit[] = [];

  for (let i = 0; i < plan.lineEdits.length; i++) {
    const { line: targetLine, newText: lineText } = plan.lineEdits[i];
    const segmentEdits = distributeTextToSegments(targetLine, lineText);
    for (let j = 0; j < segmentEdits.length; j++) {
      edits.push({
        targetRun: segmentEdits[j].run,
        newText: segmentEdits[j].newText,
      });
    }
  }

  const result = applyTextEdits(contentBytes, page, objects, edits);
  // Position-preserving: only apply horizontal shifts within the line (never dy)
  const horizShifts = plan.shifts.filter(s => Math.abs(s.dy) < 0.01 && Math.abs(s.dx) > 0.01);
  if (horizShifts.length === 0) return result;

  return {
    ...result,
    newContentBytes: applyRunPositionShifts(result.newContentBytes, horizShifts),
  };
}

export { buildLayoutPlan };
