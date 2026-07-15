import { bboxFromPoints, type BoundingBox } from '../common/geometry.js';
import type { SemanticNode } from '../semantic/types.js';
import type { ITableCandidateDetector, TableEngineInput } from './algorithms/types.js';
import type { TableCandidate } from './types.js';

// Headings/titles are allowed — short bold header cells are often typed as
// headings by the semantic stage and must still join table lattices.
const SKIP_TYPES = new Set([
  'list',
  'list_item',
  'code_block',
  'image',
  'hyperlink',
  'section',
  'subsection',
  'document',
  'table',
]);

/**
 * Find page regions where text blocks form a regular lattice (≥2×2).
 */
export class TableCandidateDetector implements ITableCandidateDetector {
  readonly name = 'TableCandidateDetector';

  detect(input: TableEngineInput): TableCandidate[] {
    const byPage = new Map<number, SemanticNode[]>();

    for (const id of input.semantic.readingOrder) {
      const node = input.semantic.nodes[id];
      if (!node || !node.bbox) continue;
      if (SKIP_TYPES.has(node.type)) continue;
      if (!('text' in node) || !node.text?.trim()) continue;
      let arr = byPage.get(node.pageIndex);
      if (!arr) {
        arr = [];
        byPage.set(node.pageIndex, arr);
      }
      arr.push(node);
    }

    const out: TableCandidate[] = [];
    for (const [pageIndex, nodes] of byPage) {
      if (nodes.length < 4) {
        // Still allow if vectors suggest a grid
        const hasBorders = pageHasTableVectors(input, pageIndex);
        if (!hasBorders) continue;
      }

      const clusters = clusterLattice(nodes);
      for (const cluster of clusters) {
        if (cluster.nodeIds.length < 4) continue;
        const hasVectorBorders = pageHasTableVectors(input, pageIndex, cluster.bbox);
        const score =
          0.4 +
          Math.min(0.4, cluster.regularity) +
          (hasVectorBorders ? 0.2 : 0) +
          Math.min(0.1, cluster.nodeIds.length / 40);

        out.push({
          pageIndex,
          bbox: cluster.bbox,
          nodeIds: cluster.nodeIds,
          score,
          hasVectorBorders,
        });
      }
    }

    return out.sort((a, b) => b.score - a.score);
  }
}

function clusterLattice(nodes: SemanticNode[]): Array<{
  nodeIds: string[];
  bbox: BoundingBox;
  regularity: number;
}> {
  // Greedy: take all text nodes on page that share column/row alignment as one candidate
  // Split into separate tables if there's a large vertical gap
  const sorted = [...nodes].sort(
    (a, b) =>
      (b.bbox!.y + b.bbox!.height) - (a.bbox!.y + a.bbox!.height) ||
      a.bbox!.x - b.bbox!.x,
  );

  const groups: SemanticNode[][] = [];
  let current: SemanticNode[] = [];

  for (const n of sorted) {
    if (current.length === 0) {
      current.push(n);
      continue;
    }
    const prev = current[current.length - 1]!;
    const gap =
      (prev.bbox!.y) - (n.bbox!.y + n.bbox!.height);
    // Large gap → new table candidate
    if (gap > 48) {
      groups.push(current);
      current = [n];
    } else {
      current.push(n);
    }
  }
  if (current.length) groups.push(current);

  return groups
    .map((group) => {
      const xs = snapPositions(group.map((g) => g.bbox!.x + g.bbox!.width / 2), 8);
      const ys = snapPositions(
        group.map((g) => g.bbox!.y + g.bbox!.height / 2),
        8,
      );
      const cols = xs.length;
      const rows = ys.length;
      if (cols < 2 || rows < 2) {
        return null;
      }
      // Regularity: how well nodes fill the grid
      const expected = cols * rows;
      const regularity = Math.min(1, group.length / Math.max(expected * 0.5, 1));
      const bbox = bboxFromPoints(
        group.flatMap((g) => [
          { x: g.bbox!.x, y: g.bbox!.y },
          { x: g.bbox!.x + g.bbox!.width, y: g.bbox!.y + g.bbox!.height },
        ]),
      );
      return {
        nodeIds: group.map((g) => g.id),
        bbox,
        regularity,
      };
    })
    .filter((c): c is NonNullable<typeof c> => c != null);
}

function snapPositions(values: number[], tol: number): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const out: number[] = [];
  for (const v of sorted) {
    if (out.length === 0 || Math.abs(out[out.length - 1]! - v) > tol) {
      out.push(v);
    }
  }
  return out;
}

function pageHasTableVectors(
  input: TableEngineInput,
  pageIndex: number,
  bbox?: BoundingBox,
): boolean {
  const page = input.raw.pages.find((p) => p.index === pageIndex);
  if (!page) return false;
  let lines = 0;
  for (const v of page.vectors) {
    if (bbox && !intersects(v.bbox, bbox)) continue;
    for (const cmd of v.pathCommands) {
      if (cmd.op === 're') lines += 1;
      if (cmd.op === 'l' || cmd.op === 'm') lines += 0.25;
    }
  }
  return lines >= 2;
}

function intersects(a: BoundingBox, b: BoundingBox): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}
