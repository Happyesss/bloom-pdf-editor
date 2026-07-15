import type { IReadingOrderBuilder } from './algorithms/types.js';
import type {
  LayoutRegion,
  ReadingOrderEdge,
  ReadingOrderGraph,
  WhitespaceSignals,
  WritingDirection,
} from './types.js';

/**
 * Column-aware reading order.
 * Does NOT simply sort by Y — groups into columns via gutters, then
 * top→bottom within column, left→right across columns (LTR).
 */
export class ReadingOrderBuilder implements IReadingOrderBuilder {
  readonly name = 'ReadingOrderBuilder';

  build(input: {
    pageWidth: number;
    pageHeight: number;
    regions: LayoutRegion[];
    whitespace: WhitespaceSignals;
    writingDirection: WritingDirection;
  }): ReadingOrderGraph {
    const { pageWidth, regions, whitespace, writingDirection } = input;
    if (regions.length === 0) {
      return { regionIds: [], edges: [], order: [] };
    }

    const gutters = [...whitespace.columnGutters].sort((a, b) => a - b);
    const columns = assignColumns(regions, gutters, pageWidth);

    // Sort column indices
    const colIds = [...new Set(columns.values())].sort((a, b) =>
      writingDirection === 'rtl' ? b - a : a - b,
    );

    const order: string[] = [];
    const edges: ReadingOrderEdge[] = [];

    // Headers first, footers last (by kind), regardless of column
    const headers = regions.filter((r) => r.kind === 'header');
    const footers = regions.filter((r) => r.kind === 'footer');
    const body = regions.filter((r) => r.kind !== 'header' && r.kind !== 'footer');

    const appendGroup = (group: LayoutRegion[]) => {
      // Group by column
      const byCol = new Map<number, LayoutRegion[]>();
      for (const r of group) {
        const c = columns.get(r.id) ?? 0;
        let arr = byCol.get(c);
        if (!arr) {
          arr = [];
          byCol.set(c, arr);
        }
        arr.push(r);
      }

      const colOrder = [...byCol.keys()].sort((a, b) =>
        writingDirection === 'rtl' ? b - a : a - b,
      );

      for (const c of colOrder) {
        const list = byCol.get(c)!;
        // Top-to-bottom: higher y first (PDF y-up)
        list.sort((a, b) => b.bbox.y + b.bbox.height - (a.bbox.y + a.bbox.height));
        for (const r of list) {
          r.columnIndex = c;
          if (order.length > 0) {
            edges.push({ from: order[order.length - 1]!, to: r.id, weight: 1 });
          }
          order.push(r.id);
        }
      }
    };

    // Headers across full width first (top-to-bottom)
    headers.sort((a, b) => b.bbox.y + b.bbox.height - (a.bbox.y + a.bbox.height));
    for (const h of headers) {
      if (order.length > 0) edges.push({ from: order[order.length - 1]!, to: h.id, weight: 1 });
      order.push(h.id);
    }

    appendGroup(body);

    footers.sort((a, b) => b.bbox.y + b.bbox.height - (a.bbox.y + a.bbox.height));
    for (const f of footers) {
      if (order.length > 0) edges.push({ from: order[order.length - 1]!, to: f.id, weight: 1 });
      order.push(f.id);
    }

    // Assign readingOrderIndex
    const indexOf = new Map(order.map((id, i) => [id, i]));
    for (const r of regions) {
      r.readingOrderIndex = indexOf.get(r.id) ?? -1;
      r.readingPriority = r.readingOrderIndex;
      for (let i = 0; i < r.blocks.length; i++) {
        r.blocks[i]!.readingOrderIndex = r.readingOrderIndex * 1000 + i;
      }
    }

    // Ensure colIds referenced (lint)
    void colIds;

    return {
      regionIds: regions.map((r) => r.id),
      edges,
      order,
    };
  }
}

function assignColumns(
  regions: LayoutRegion[],
  gutters: number[],
  pageWidth: number,
): Map<string, number> {
  const bounds = [0, ...gutters, pageWidth];
  const map = new Map<string, number>();

  for (const r of regions) {
    const cx = r.bbox.x + r.bbox.width / 2;
    let col = 0;
    for (let i = 0; i < bounds.length - 1; i++) {
      if (cx >= bounds[i]! && cx < bounds[i + 1]!) {
        col = i;
        break;
      }
      col = i;
    }
    map.set(r.id, col);
  }
  return map;
}
