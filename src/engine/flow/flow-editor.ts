/**
 * Flow-aware text editing — commit full-line edits across styled runs.
 */

import type { TextRun } from '../content/interpreter';
import type { PDFObject, PDFPageInfo } from '../types';
import {
  applyTextEdits,
  applyRunPositionShifts,
  type EditResult,
  type TextEdit,
  type RunPositionShift,
} from '../editor/text-editor';
import { distributeTextChangeToSegments, distributeTextToSegments } from './reflow';
import {
  computeLayoutPlan,
  computeHorizontalShifts,
  computeHorizontalShiftsFromEdits,
  findParagraphForLine,
  type LayoutPlan,
} from './layout';
import { estimateTextWidth, visualFontSize } from './metrics';
import type { DocumentFlow, TextLine } from './types';

/**
 * Width growth of the edited line itself. Needed when title|tags have already
 * been split into separate flow cells — segment shifts are empty (segCount=1)
 * but peers on the same baseline still need to move.
 */
function estimateLineGrowthDx(line: TextLine, oldText: string, newText: string): number {
  if (newText.length <= oldText.length) return 0;
  const run = line.segments[0]?.run ?? line.runs[0];
  if (!run) return 0;

  const oldW = Math.max(line.width, estimateTextWidth(oldText, run), 0.01);
  const estimated = estimateTextWidth(newText, run);
  const scaled = oldW * (newText.length / Math.max(1, oldText.length));
  const fs = visualFontSize(run);
  const growFloor = oldW + (newText.length - oldText.length) * fs * 0.5;
  const newW = Math.max(estimated, scaled, growFloor);
  return Math.max(0, newW - oldW);
}

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
 * Resume title rows are often split into left (title|tags) + right (date) cells.
 * Growing the left cell shifts tags right — also nudge same-baseline runs that
 * start past the edited line so "Currently Working" doesn't get buried.
 */
function collectRightColumnShifts(
  line: TextLine,
  flow: DocumentFlow | undefined,
  growthDx: number,
): RunPositionShift[] {
  if (!flow?.rawRuns?.length || growthDx < 0.5) return [];

  const owned = new Set<TextRun>(line.runs);
  const fs = Math.max(line.fontSize, 8);
  const fence = line.rightEdge - fs * 0.25;
  const shifts: RunPositionShift[] = [];

  for (let i = 0; i < flow.rawRuns.length; i++) {
    const run = flow.rawRuns[i];
    if (owned.has(run)) continue;
    if ((run.sourceInstructionIndices ?? []).length === 0) continue;

    const baseline = run.glyphs.length > 0 ? run.glyphs[0].tRm.f : run.y;
    if (Math.abs(baseline - line.baseline) > Math.max(2, fs * 0.35)) continue;
    if (run.x < fence) continue;

    shifts.push({ run, dx: growthDx, dy: 0 });
  }

  return shifts;
}

export interface LineTextEditOptions {
  /** Original line text at edit-session start (for caret-aware redistribute). */
  oldText?: string;
  /** Caret index after the edit (matches overlay preview). */
  caretAfter?: number;
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
  options?: LineTextEditOptions,
): EditResult {
  const plan = buildLayoutPlan(flow, line, newText);
  const edits: TextEdit[] = [];
  const oldText = options?.oldText ?? line.text;
  const caretAfter = options?.caretAfter ?? newText.length;

  let primarySegmentEdits: ReturnType<typeof distributeTextChangeToSegments> | null = null;
  let primaryLine = line;

  for (let i = 0; i < plan.lineEdits.length; i++) {
    const { line: targetLine, newText: lineText } = plan.lineEdits[i];
    // Prefer caret-aware split (same as the live overlay) so commit matches preview.
    const segmentEdits = i === 0 && (options?.oldText != null || options?.caretAfter != null)
      ? distributeTextChangeToSegments(targetLine, oldText, lineText, caretAfter)
      : distributeTextToSegments(targetLine, lineText);
    if (i === 0) {
      primarySegmentEdits = segmentEdits;
      primaryLine = targetLine;
    }
    for (let j = 0; j < segmentEdits.length; j++) {
      edits.push({
        targetRun: segmentEdits[j].run,
        newText: segmentEdits[j].newText,
      });
    }
  }

  // Shifts must use the same caret-aware split as the text rewrite.
  const editShifts = primarySegmentEdits
    ? computeHorizontalShiftsFromEdits(primaryLine, primarySegmentEdits)
    : plan.shifts;

  let horizShifts = editShifts.filter(s => Math.abs(s.dy) < 0.01 && Math.abs(s.dx) > 0.01);
  const segmentGrowthDx = horizShifts.reduce((m, s) => Math.max(m, s.dx), 0);
  // After column split, title is alone — use line width growth so same-baseline
  // tags/dates still get collectRightColumnShifts.
  const lineGrowthDx = estimateLineGrowthDx(primaryLine, oldText, newText);
  const growthDx = Math.max(segmentGrowthDx, lineGrowthDx);
  const rightShifts = collectRightColumnShifts(primaryLine, flow, growthDx);
  if (rightShifts.length > 0) {
    horizShifts = [...horizShifts, ...rightShifts];
  }

  // Apply position shifts FIRST while sourceInstructionIndices still match the
  // stream. applyTextEdits inserts erase ops that invalidate those indices, so
  // shifting afterward silently no-ops and trailing runs overlap grown text.
  let bytes = contentBytes;
  if (horizShifts.length > 0) {
    bytes = applyRunPositionShifts(
      bytes,
      horizShifts,
      edits.map(e => e.targetRun),
    );
  }

  return applyTextEdits(bytes, page, objects, edits);
}

export { buildLayoutPlan };
