import { createId } from '../../utils/id.js';
import { bboxFromPoints, type BoundingBox } from '../common/geometry.js';
import type { SemanticNode, SemanticRun } from '../semantic/types.js';
import type { ICellFiller, ICellMerger, TableEngineInput } from './algorithms/types.js';
import type { LogicalCell, TableCandidate, TableGrid } from './types.js';

export class CellFiller implements ICellFiller {
  readonly name = 'CellFiller';

  fill(
    grid: TableGrid,
    candidate: TableCandidate,
    input: TableEngineInput,
  ): LogicalCell[] {
    const colCount = grid.xs.length - 1;
    const rowCount = grid.ys.length - 1;
    if (colCount < 1 || rowCount < 1) return [];

    // ys are bottom-up in PDF; row 0 = top visually = highest y band
    const rowBands = buildRowBands(grid.ys);
    const cells: LogicalCell[] = [];
    const tableId = 'pending'; // filled by engine

    const buckets = new Map<string, SemanticNode[]>();
    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        buckets.set(`${r},${c}`, []);
      }
    }

    for (const id of candidate.nodeIds) {
      const node = input.semantic.nodes[id];
      if (!node?.bbox) continue;
      const cx = node.bbox.x + node.bbox.width / 2;
      const cy = node.bbox.y + node.bbox.height / 2;
      const col = findIndex(grid.xs, cx);
      const row = findRowIndex(rowBands, cy);
      if (col < 0 || row < 0) continue;
      buckets.get(`${row},${col}`)?.push(node);
    }

    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        const nodes = buckets.get(`${r},${c}`) ?? [];
        nodes.sort((a, b) => a.readingOrderIndex - b.readingOrderIndex);
        const bbox = cellBBox(grid, r, c, rowBands);
        const text = nodes
          .map((n) => ('text' in n ? String(n.text ?? '') : ''))
          .filter(Boolean)
          .join(' ')
          .trim();
        const runs: SemanticRun[] = nodes.flatMap((n) =>
          'runs' in n && Array.isArray(n.runs) ? n.runs : [],
        );
        const contentBBox = nodes.some((n) => n.bbox)
          ? bboxFromPoints(
              nodes.flatMap((n) =>
                n.bbox
                  ? [
                      { x: n.bbox.x, y: n.bbox.y },
                      { x: n.bbox.x + n.bbox.width, y: n.bbox.y + n.bbox.height },
                    ]
                  : [],
              ),
            )
          : undefined;

        cells.push({
          id: createId('tcell'),
          parentId: tableId,
          childIds: [],
          rowIndex: r,
          colIndex: c,
          rowSpan: 1,
          colSpan: 1,
          bbox,
          contentBBox,
          text,
          runs,
          alignment: inferAlign(nodes, bbox),
          padding: { top: 2, right: 2, bottom: 2, left: 2 },
          contentNodeIds: nodes.map((n) => n.id),
          confidence: nodes.length ? 0.85 : 0.4,
        });
      }
    }

    return cells;
  }
}

export class CellMerger implements ICellMerger {
  readonly name = 'CellMerger';

  merge(cells: LogicalCell[], grid: TableGrid): LogicalCell[] {
    const colCount = grid.xs.length - 1;
    const rowCount = grid.ys.length - 1;
    const byKey = new Map(cells.map((c) => [`${c.rowIndex},${c.colIndex}`, c]));
    const absorbed = new Set<string>();

    // Horizontal merges: empty neighbors to the right of a filled cell that
    // visually spans (content extent reaches into the empty slot) or, in
    // bordered mode, when no vertical separator sits between the slots.
    for (let r = 0; r < rowCount; r++) {
      for (let c = 0; c < colCount; c++) {
        const cell = byKey.get(`${r},${c}`);
        if (!cell || absorbed.has(cell.id) || !cell.text.trim()) continue;

        const contentRight = contentRightEdge(cell);
        let span = 1;
        while (c + span < colCount) {
          const next = byKey.get(`${r},${c + span}`);
          if (!next || absorbed.has(next.id) || next.text.trim()) break;

          const nextMid = next.bbox.x + next.bbox.width * 0.35;
          const reaches = contentRight >= nextMid;
          const noVSep =
            grid.kind === 'bordered' &&
            !hasVerticalLineNear(grid, grid.xs[c + span]!);

          if (!reaches && !noVSep && contentRight < next.bbox.x) break;

          absorbed.add(next.id);
          span++;
        }
        if (span > 1) {
          cell.colSpan = span;
          cell.bbox = {
            x: grid.xs[c]!,
            y: cell.bbox.y,
            width: grid.xs[c + span]! - grid.xs[c]!,
            height: cell.bbox.height,
          };
          cell.confidence = Math.min(0.95, cell.confidence + 0.05);
        }
      }
    }

    // Vertical merges: empty cell below
    for (let c = 0; c < colCount; c++) {
      for (let r = 0; r < rowCount; r++) {
        const cell = byKey.get(`${r},${c}`);
        if (!cell || absorbed.has(cell.id) || !cell.text) continue;
        let span = 1;
        while (r + span < rowCount) {
          const next = byKey.get(`${r + span},${c}`);
          if (!next || absorbed.has(next.id) || next.text.trim()) break;
          absorbed.add(next.id);
          span++;
        }
        if (span > 1) {
          cell.rowSpan = span;
          cell.confidence = Math.min(0.95, cell.confidence + 0.05);
        }
      }
    }

    return cells.filter((c) => !absorbed.has(c.id));
  }
}

function buildRowBands(ys: number[]): Array<{ lo: number; hi: number }> {
  // ys ascending (bottom to top in PDF). Row 0 = top = last band
  const sorted = [...ys].sort((a, b) => a - b);
  const bands: Array<{ lo: number; hi: number }> = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    bands.push({ lo: sorted[i]!, hi: sorted[i + 1]! });
  }
  // Reverse so index 0 is top
  return bands.reverse();
}

function findIndex(edges: number[], value: number): number {
  for (let i = 0; i < edges.length - 1; i++) {
    if (value >= edges[i]! - 0.5 && value < edges[i + 1]! + 0.5) return i;
  }
  // Clamp to nearest
  if (value < edges[0]!) return 0;
  if (value >= edges[edges.length - 1]!) return Math.max(0, edges.length - 2);
  return -1;
}

function findRowIndex(bands: Array<{ lo: number; hi: number }>, y: number): number {
  for (let i = 0; i < bands.length; i++) {
    if (y >= bands[i]!.lo - 0.5 && y < bands[i]!.hi + 0.5) return i;
  }
  return -1;
}

function cellBBox(
  grid: TableGrid,
  row: number,
  col: number,
  rowBands: Array<{ lo: number; hi: number }>,
): BoundingBox {
  const band = rowBands[row]!;
  return {
    x: grid.xs[col]!,
    y: band.lo,
    width: grid.xs[col + 1]! - grid.xs[col]!,
    height: band.hi - band.lo,
  };
}

function contentRightEdge(cell: LogicalCell): number {
  if (cell.contentBBox) {
    return cell.contentBBox.x + cell.contentBBox.width;
  }
  if (cell.text) {
    const fs = cell.runs[0]?.fontSize ?? 12;
    return cell.bbox.x + cell.text.length * fs * 0.55;
  }
  return cell.bbox.x;
}

function hasVerticalLineNear(grid: TableGrid, x: number): boolean {
  return grid.lines.some(
    (l) => l.orientation === 'v' && Math.abs(l.position - x) < 2,
  );
}

function inferAlign(
  nodes: SemanticNode[],
  cell: BoundingBox,
): LogicalCell['alignment'] {
  if (nodes.length === 0) return 'left';
  let left = 0;
  let center = 0;
  let right = 0;
  for (const n of nodes) {
    if (!n.bbox) continue;
    const mid = n.bbox.x + n.bbox.width / 2;
    const cellMid = cell.x + cell.width / 2;
    if (Math.abs(mid - cellMid) < cell.width * 0.15) center++;
    else if (n.bbox.x + n.bbox.width > cell.x + cell.width * 0.7) right++;
    else left++;
  }
  if (center >= left && center >= right) return 'center';
  if (right > left) return 'right';
  return 'left';
}
