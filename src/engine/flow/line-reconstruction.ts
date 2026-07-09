/**
 * Line reconstruction — group absolute PDF runs into logical lines.
 *
 * Algorithm (baseline clustering, used by PDF.js / MuPDF / Acrobat):
 *   1. Compute baseline y for each run (median glyph y).
 *   2. Sort runs by baseline descending (top of page first in PDF coords).
 *   3. Greedy cluster: assign run to line if |baseline − lineBaseline| < ε.
 *   4. Sort runs within line by left edge (reading order).
 *   5. Detect justification from inter-run gap distribution.
 */

import type { TextRun } from '../content/interpreter';
import type { StyledSegment, TextLine } from './types';
import { computeBaseline, getRunBounds } from './metrics';
import { detectTabSplitIndex, detectJustifiedBodyText } from './justification-detect';

let lineIdCounter = 0;

function nextLineId(): string {
  lineIdCounter += 1;
  return `line-${lineIdCounter}`;
}

export function resetLineIdCounter(): void {
  lineIdCounter = 0;
}

function buildSegments(runs: TextRun[]): StyledSegment[] {
  const segments: StyledSegment[] = [];
  let index = 0;
  for (let i = 0; i < runs.length; i++) {
    const run = runs[i];
    const text = run.text;
    segments.push({
      run,
      startIndex: index,
      endIndex: index + text.length,
      text,
    });
    index += text.length;
  }
  return segments;
}

function detectJustification(runs: TextRun[], fontSize: number, text: string, tabSplitIndex: number): boolean {
  return detectJustifiedBodyText(runs, fontSize, text, tabSplitIndex);
}

function finalizeLine(runs: TextRun[]): TextLine {
  const sorted = [...runs].sort((a, b) => getRunBounds(a).left - getRunBounds(b).left);
  const segments = buildSegments(sorted);
  const text = sorted.map(r => r.text).join('');

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let fontSize = 12;
  let baselineSum = 0;

  for (let i = 0; i < sorted.length; i++) {
    const b = getRunBounds(sorted[i]);
    if (b.left < minX) minX = b.left;
    if (b.right > maxX) maxX = b.right;
    if (b.bottom < minY) minY = b.bottom;
    if (b.top > maxY) maxY = b.top;
    fontSize = Math.max(fontSize, sorted[i].fontSize || sorted[i].glyphs[0]?.fontSize || 12);
    baselineSum += computeBaseline(sorted[i]);
  }

  const baseline = baselineSum / sorted.length;
  const tabSplitIndex = detectTabSplitIndex(sorted, fontSize);

  return {
    id: nextLineId(),
    runs: sorted,
    text,
    segments,
    baseline,
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    leftMargin: minX,
    rightEdge: maxX,
    fontSize,
    isJustified: detectJustification(sorted, fontSize, text, tabSplitIndex),
    tabSplitIndex,
  };
}

/**
 * Group raw PDF text runs into logical lines.
 * Bold and regular fragments on the same baseline become one line.
 */
export function reconstructLines(runs: TextRun[]): TextLine[] {
  if (runs.length === 0) return [];

  const enriched = runs.map(run => ({
    run,
    baseline: computeBaseline(run),
    left: getRunBounds(run).left,
    fontSize: run.fontSize || run.glyphs[0]?.fontSize || 12,
  }));

  enriched.sort((a, b) => b.baseline - a.baseline || a.left - b.left);

  const clusters: TextRun[][] = [];

  for (let i = 0; i < enriched.length; i++) {
    const item = enriched[i];
    let placed = false;

    for (let c = 0; c < clusters.length; c++) {
      const cluster = clusters[c];
      const refBaseline = computeBaseline(cluster[0]);
      const refSize = cluster[0].fontSize || cluster[0].glyphs[0]?.fontSize || 12;
      const tolerance = Math.max(2, refSize * 0.35);

      if (Math.abs(item.baseline - refBaseline) <= tolerance) {
        cluster.push(item.run);
        placed = true;
        break;
      }
    }

    if (!placed) {
      clusters.push([item.run]);
    }
  }

  const lines = clusters.map(finalizeLine);
  lines.sort((a, b) => b.baseline - a.baseline);
  return lines;
}
