/**
 * Justification vs tab detection — distinguish body-text justification
 * from left/right column layouts (e.g. title + dates on same baseline).
 */

import type { TextRun } from '../content/interpreter';
import type { TextLine } from './types';
import { averageCharWidth, gapBetweenRuns, getRunBounds } from './metrics';

/**
 * Detect a tab-style gap splitting left content from right-aligned content.
 * Returns the index of the last run in the left column, or -1 if none.
 */
export function detectTabSplitIndex(runs: TextRun[], fontSize: number): number {
  if (runs.length < 2) return -1;

  const avgCharW = runs.reduce((s, r) => s + averageCharWidth(r), 0) / runs.length;
  const gaps: Array<{ index: number; size: number }> = [];

  for (let i = 0; i < runs.length - 1; i++) {
    gaps.push({ index: i, size: gapBetweenRuns(runs[i], runs[i + 1]) });
  }

  gaps.sort((a, b) => b.size - a.size);
  const largest = gaps[0];
  const tabThreshold = Math.max(fontSize * 4, avgCharW * 6);

  if (largest.size < tabThreshold) return -1;

  const second = gaps.length > 1 ? gaps[1].size : 0;
  if (largest.size > second * 2.5) {
    return largest.index;
  }

  return -1;
}

/**
 * True only for dense body-text lines with multiple expanded inter-word gaps.
 * Rejects tab-aligned lines, short lines, headers, and bullet lines.
 */
export function detectJustifiedBodyText(
  runs: TextRun[],
  fontSize: number,
  text: string,
  tabSplitIndex: number,
): boolean {
  if (tabSplitIndex >= 0) return false;
  if (runs.length < 2) return false;

  const wordCount = text.trim().split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount < 4) return false;

  const avgCharW = runs.reduce((s, r) => s + averageCharWidth(r), 0) / runs.length;
  const naturalThreshold = Math.max(fontSize * 0.5, avgCharW * 1.8);
  const largeGaps: number[] = [];

  for (let i = 0; i < runs.length - 1; i++) {
    const gap = gapBetweenRuns(runs[i], runs[i + 1]);
    if (gap > naturalThreshold) largeGaps.push(gap);
  }

  // Body justification expands multiple word gaps, not a single tab column.
  return largeGaps.length >= 2;
}

/** Whether flow-based redraw should replace raw PDF positions for this line. */
export function shouldUseFlowDraw(line: TextLine): boolean {
  if (!line.isJustified) return false;
  if (line.tabSplitIndex >= 0) return false;

  const wordCount = line.text.trim().split(/\s+/).filter(w => w.length > 0).length;
  if (wordCount < 4) return false;

  const targetWidth = line.rightEdge - line.leftMargin;
  if (targetWidth <= 0) return false;

  let naturalWidth = 0;
  for (let r = 0; r < line.runs.length; r++) {
    naturalWidth += getRunBounds(line.runs[r]).width;
  }

  // Line is mostly empty space — tab/header layout, not justified prose.
  if (naturalWidth / targetWidth < 0.55) return false;

  const extraSpace = targetWidth - naturalWidth;
  const numGaps = wordCount - 1;
  if (numGaps <= 0) return false;

  const evenGap = extraSpace / numGaps;
  const normalSpace = Math.max(line.fontSize * 0.25, 2);

  // If gaps would exceed ~2× normal word space, PDF positions are better.
  if (evenGap > normalSpace * 2) return false;

  return true;
}
