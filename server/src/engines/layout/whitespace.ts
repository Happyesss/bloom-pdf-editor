import type { IWhitespaceAnalyzer } from './algorithms/types.js';
import type { ClusteredObject, WhitespaceSignals } from './types.js';

/**
 * Projection-profile whitespace analysis.
 * Detects margins, column gutters, and large gaps used by XY-Cut.
 */
export class WhitespaceAnalyzer implements IWhitespaceAnalyzer {
  readonly name = 'WhitespaceAnalyzer';

  analyze(input: {
    pageWidth: number;
    pageHeight: number;
    clusters: ClusteredObject[];
  }): WhitespaceSignals {
    const { pageWidth, pageHeight, clusters } = input;
    const binsX = Math.max(32, Math.floor(pageWidth));
    const binsY = Math.max(32, Math.floor(pageHeight));

    const vProjection = new Array(binsX).fill(0) as number[];
    const hProjection = new Array(binsY).fill(0) as number[];

    // Prefer text clusters / lines / words for whitespace; ignore tiny vectors
    const content = clusters.filter(
      (c) =>
        c.kind === 'text_cluster' ||
        c.kind === 'line' ||
        c.kind === 'word' ||
        c.kind === 'image',
    );

    for (const c of content) {
      const x0 = clamp(Math.floor(c.bbox.x), 0, binsX - 1);
      const x1 = clamp(Math.floor(c.bbox.x + c.bbox.width), 0, binsX - 1);
      const y0 = clamp(Math.floor(c.bbox.y), 0, binsY - 1);
      const y1 = clamp(Math.floor(c.bbox.y + c.bbox.height), 0, binsY - 1);
      for (let x = x0; x <= x1; x++) vProjection[x]! += 1;
      for (let y = y0; y <= y1; y++) hProjection[y]! += 1;
    }

    const margins = detectMargins(vProjection, hProjection, pageWidth, pageHeight);
    const verticalGaps = findValleys(vProjection, pageWidth / binsX, 8);
    const horizontalGaps = findValleys(hProjection, pageHeight / binsY, 8);

    // Column gutters: deep valleys in the middle 60% of the page
    const columnGutters = verticalGaps.filter(
      (x) => x > pageWidth * 0.2 && x < pageWidth * 0.8,
    );

    return {
      pageIndex: content[0]?.pageIndex ?? 0,
      margins,
      columnGutters,
      horizontalGaps,
      verticalGaps,
      hProjection,
      vProjection,
    };
  }
}

function detectMargins(
  vProj: number[],
  hProj: number[],
  pageWidth: number,
  pageHeight: number,
): WhitespaceSignals['margins'] {
  const left = firstNonZero(vProj);
  const right = lastNonZero(vProj);
  const bottom = firstNonZero(hProj);
  const top = lastNonZero(hProj);

  const scaleX = pageWidth / Math.max(vProj.length, 1);
  const scaleY = pageHeight / Math.max(hProj.length, 1);

  return {
    left: left * scaleX,
    right: Math.max(0, pageWidth - (right + 1) * scaleX),
    bottom: bottom * scaleY,
    top: Math.max(0, pageHeight - (top + 1) * scaleY),
  };
}

function firstNonZero(arr: number[]): number {
  for (let i = 0; i < arr.length; i++) if (arr[i]! > 0) return i;
  return 0;
}

function lastNonZero(arr: number[]): number {
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i]! > 0) return i;
  return Math.max(arr.length - 1, 0);
}

/** Find centers of zero-runs (valleys) longer than minWidth units. */
function findValleys(projection: number[], unitSize: number, minUnits: number): number[] {
  const valleys: number[] = [];
  let i = 0;
  while (i < projection.length) {
    if (projection[i]! === 0) {
      const start = i;
      while (i < projection.length && projection[i] === 0) i++;
      const len = i - start;
      if (len >= minUnits) {
        const center = (start + i) / 2;
        valleys.push(center * unitSize);
      }
    } else {
      i++;
    }
  }
  return valleys;
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
