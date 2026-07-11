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

/**
 * Measure inter-word gaps from native glyph x-positions.
 * Returns gap sizes for gaps large enough to be word boundaries.
 */
function measureNativeWordGaps(line: TextLine): number[] {
  const positions: Array<{ x: number; width: number }> = [];
  for (let r = 0; r < line.runs.length; r++) {
    const run = line.runs[r];
    for (let g = 0; g < run.glyphs.length; g++) {
      const gl = run.glyphs[g];
      positions.push({ x: gl.tRm.e, width: gl.width });
    }
  }

  if (positions.length < 2) return [];
  positions.sort((a, b) => a.x - b.x);

  let totalW = 0;
  for (let i = 0; i < positions.length; i++) totalW += positions[i].width;
  const avgW = totalW / positions.length;
  // Use a low threshold to catch most word boundaries (including narrow spaces)
  const wordGapMin = avgW * 0.2;

  const gaps: number[] = [];
  for (let i = 1; i < positions.length; i++) {
    const gap = positions[i].x - (positions[i - 1].x + positions[i - 1].width);
    if (gap > wordGapMin) gaps.push(gap);
  }

  return gaps;
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

  // Check if native glyph positions already have reasonable inter-word gaps.
  // The PDF's own positioning is almost always better than flow-draw's
  // recalculation, so only override when gaps are wildly disproportionate.
  const nativeGaps = measureNativeWordGaps(line);

  // Not enough measurable gaps — can't confirm text needs redistribution
  if (nativeGaps.length < 3) return false;

  const mean = nativeGaps.reduce((s, g) => s + g, 0) / nativeGaps.length;
  if (mean <= 0) return false;

  const variance = nativeGaps.reduce((s, g) => s + (g - mean) ** 2, 0) / nativeGaps.length;
  const cv = Math.sqrt(variance) / mean;

  // Only override when gaps are extremely uneven (CV > 0.8)
  // AND the largest gap is more than 3× the smallest (truly broken layout)
  const minGap = Math.min(...nativeGaps);
  const maxGap = Math.max(...nativeGaps);
  if (cv < 0.8 || minGap <= 0 || maxGap / minGap < 3) return false;

  return true;
}
