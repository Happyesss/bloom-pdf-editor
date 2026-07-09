/**
 * Justification analysis and space distribution.
 *
 * PDF justified lines encode extra space in TJ numeric arrays (thousandths of em)
 * and/or Tw (word spacing). This module analyzes gaps and computes even distribution.
 *
 * Maths:
 *   displacement = −n/1000 × fontSize × (Tz/100)   (PDF TJ spec)
 *   justified gap = (targetWidth − naturalWidth) / numWordBoundaries
 */

import type { TextRun } from '../content/interpreter';
import type { TextLine } from './types';
import { averageCharWidth, gapBetweenRuns, getRunBounds } from './metrics';

export interface JustificationAnalysis {
  naturalWidth: number;
  actualWidth: number;
  extraSpace: number;
  wordBoundaries: number;
  gaps: Array<{ betweenRuns: [number, number]; gap: number; isLarge: boolean }>;
}

/** Count word boundaries (spaces) across all runs on a line. */
export function countWordBoundaries(line: TextLine): number {
  let count = 0;
  for (let i = 0; i < line.text.length; i++) {
    if (line.text[i] === ' ') count++;
  }
  return count;
}

/** Analyze how space is distributed across a line's runs. */
export function analyzeJustification(line: TextLine): JustificationAnalysis {
  const gaps: JustificationAnalysis['gaps'] = [];
  let naturalWidth = 0;
  const avgCharW = line.runs.reduce((s, r) => s + averageCharWidth(r), 0) / Math.max(1, line.runs.length);
  const largeGapThreshold = Math.max(line.fontSize * 0.5, avgCharW * 1.8);

  for (let i = 0; i < line.runs.length; i++) {
    naturalWidth += getRunBounds(line.runs[i]).width;
    if (i < line.runs.length - 1) {
      const gap = gapBetweenRuns(line.runs[i], line.runs[i + 1]);
      gaps.push({
        betweenRuns: [i, i + 1],
        gap,
        isLarge: gap > largeGapThreshold,
      });
    }
  }

  const actualWidth = line.width;
  const extraSpace = Math.max(0, actualWidth - naturalWidth);

  return {
    naturalWidth,
    actualWidth,
    extraSpace,
    wordBoundaries: countWordBoundaries(line),
    gaps,
  };
}

/**
 * Compute per-gap justified spacing for even word distribution.
 * Returns gap adjustments in PDF units to add between runs.
 */
export function distributeJustifiedSpace(line: TextLine): number[] {
  const analysis = analyzeJustification(line);
  if (!line.isJustified || analysis.gaps.length === 0) {
    return analysis.gaps.map(g => g.gap);
  }

  const largeGaps = analysis.gaps.filter(g => g.isLarge);
  if (largeGaps.length === 0) return analysis.gaps.map(g => g.gap);

  const totalLargeGap = largeGaps.reduce((s, g) => s + g.gap, 0);
  const evenGap = totalLargeGap / largeGaps.length;

  return analysis.gaps.map(g => g.isLarge ? evenGap : g.gap);
}

/** TJ array spacing value (thousandths) for a gap in PDF units. */
export function gapToTJSpacing(gap: number, fontSize: number): number {
  if (fontSize <= 0) return 0;
  return Math.round(-(gap / fontSize) * 1000);
}
