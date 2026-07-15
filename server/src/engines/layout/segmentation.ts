import type { BoundingBox } from '../common/geometry.js';
import type { IPageSegmenter } from './algorithms/types.js';
import type { LayoutBlock, SegmentCandidate, WhitespaceSignals } from './types.js';

/**
 * Recursive XY-Cut page segmentation driven by whitespace valleys.
 */
export class XYCutSegmenter implements IPageSegmenter {
  readonly name = 'XYCutSegmenter';

  segment(input: {
    pageWidth: number;
    pageHeight: number;
    blocks: LayoutBlock[];
    whitespace: WhitespaceSignals;
  }): SegmentCandidate[] {
    const { pageWidth, pageHeight, blocks, whitespace } = input;
    if (blocks.length === 0) return [];

    const pageBox: BoundingBox = { x: 0, y: 0, width: pageWidth, height: pageHeight };
    const results: SegmentCandidate[] = [];
    this.cut(blocks, pageBox, whitespace, results, 0);
    return results.length > 0
      ? results
      : [{ bbox: union(blocks.map((b) => b.bbox)), blockIds: blocks.map((b) => b.id) }];
  }

  private cut(
    blocks: LayoutBlock[],
    region: BoundingBox,
    whitespace: WhitespaceSignals,
    out: SegmentCandidate[],
    depth: number,
  ): void {
    if (blocks.length === 0) return;

    if (blocks.length === 1 || depth > 12) {
      out.push({
        bbox: union(blocks.map((b) => b.bbox)),
        blockIds: blocks.map((b) => b.id),
      });
      return;
    }

    // Prefer vertical cut (columns) when gutters exist inside region
    const vCut = pickCut(
      whitespace.verticalGaps.filter((x) => x > region.x + 8 && x < region.x + region.width - 8),
      blocks,
      'vertical',
      region,
    );

    const hCut = pickCut(
      whitespace.horizontalGaps.filter((y) => y > region.y + 8 && y < region.y + region.height - 8),
      blocks,
      'horizontal',
      region,
    );

    // Prefer the cut that better balances partitions
    const chosen =
      vCut && hCut
        ? vCut.score >= hCut.score
          ? vCut
          : hCut
        : vCut ?? hCut;

    if (!chosen) {
      out.push({
        bbox: union(blocks.map((b) => b.bbox)),
        blockIds: blocks.map((b) => b.id),
      });
      return;
    }

    const leftOrBottom: LayoutBlock[] = [];
    const rightOrTop: LayoutBlock[] = [];

    if (chosen.axis === 'vertical') {
      for (const b of blocks) {
        const cx = b.bbox.x + b.bbox.width / 2;
        if (cx < chosen.position) leftOrBottom.push(b);
        else rightOrTop.push(b);
      }
      if (leftOrBottom.length === 0 || rightOrTop.length === 0) {
        out.push({
          bbox: union(blocks.map((b) => b.bbox)),
          blockIds: blocks.map((b) => b.id),
        });
        return;
      }
      const leftBox: BoundingBox = {
        x: region.x,
        y: region.y,
        width: chosen.position - region.x,
        height: region.height,
      };
      const rightBox: BoundingBox = {
        x: chosen.position,
        y: region.y,
        width: region.x + region.width - chosen.position,
        height: region.height,
      };
      this.cut(leftOrBottom, leftBox, whitespace, out, depth + 1);
      this.cut(rightOrTop, rightBox, whitespace, out, depth + 1);
    } else {
      for (const b of blocks) {
        const cy = b.bbox.y + b.bbox.height / 2;
        if (cy < chosen.position) leftOrBottom.push(b);
        else rightOrTop.push(b);
      }
      if (leftOrBottom.length === 0 || rightOrTop.length === 0) {
        out.push({
          bbox: union(blocks.map((b) => b.bbox)),
          blockIds: blocks.map((b) => b.id),
        });
        return;
      }
      const bottomBox: BoundingBox = {
        x: region.x,
        y: region.y,
        width: region.width,
        height: chosen.position - region.y,
      };
      const topBox: BoundingBox = {
        x: region.x,
        y: chosen.position,
        width: region.width,
        height: region.y + region.height - chosen.position,
      };
      // Process top first for reading-order friendliness later
      this.cut(rightOrTop, topBox, whitespace, out, depth + 1);
      this.cut(leftOrBottom, bottomBox, whitespace, out, depth + 1);
    }
  }
}

function pickCut(
  gaps: number[],
  blocks: LayoutBlock[],
  axis: 'vertical' | 'horizontal',
  region: BoundingBox,
): { axis: 'vertical' | 'horizontal'; position: number; score: number } | null {
  let best: { axis: 'vertical' | 'horizontal'; position: number; score: number } | null = null;

  for (const g of gaps) {
    let a = 0;
    let b = 0;
    for (const block of blocks) {
      const c =
        axis === 'vertical'
          ? block.bbox.x + block.bbox.width / 2
          : block.bbox.y + block.bbox.height / 2;
      if (c < g) a++;
      else b++;
    }
    if (a === 0 || b === 0) continue;

    // Prefer balanced splits near region center
    const balance = 1 - Math.abs(a - b) / (a + b);
    const center =
      axis === 'vertical'
        ? region.x + region.width / 2
        : region.y + region.height / 2;
    const centrality = 1 - Math.min(1, Math.abs(g - center) / (axis === 'vertical' ? region.width : region.height));
    const score = balance * 0.7 + centrality * 0.3;

    if (!best || score > best.score) {
      best = { axis, position: g, score };
    }
  }

  return best;
}

function union(boxes: BoundingBox[]): BoundingBox {
  if (boxes.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
