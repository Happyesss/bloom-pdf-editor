import { createId } from '../../utils/id.js';
import type { SemanticDocument, SemanticNode, SemanticTable } from '../semantic/types.js';
import type { LogicalTable } from './types.js';

/**
 * Attach SemanticTable nodes and remove absorbed paragraph/content nodes
 * from reading order + section children.
 */
export function integrateTables(
  semantic: SemanticDocument,
  tables: LogicalTable[],
): SemanticDocument {
  if (tables.length === 0) return semantic;

  const absorbed = new Set<string>();
  for (const t of tables) {
    for (const cell of t.cells) {
      for (const id of cell.contentNodeIds) absorbed.add(id);
    }
  }

  // Clone shallow structure we will mutate
  const nodes: Record<string, SemanticNode> = { ...semantic.nodes };
  const readingOrder = semantic.readingOrder.filter((id) => !absorbed.has(id));

  for (const id of absorbed) {
    delete nodes[id];
  }

  const tableNodes: SemanticTable[] = [];
  for (const table of tables) {
    const node: SemanticTable = {
      id: createId('stable'),
      type: 'table',
      parentId: null,
      childIds: [],
      readingOrderIndex: minReadingOrder(table, semantic),
      confidence: table.confidence,
      pageIndex: table.pageIndex,
      bbox: table.bbox,
      sourceBlockIds: [...new Set(table.cells.flatMap((c) => c.contentNodeIds))],
      logicalTableId: table.id,
      rowCount: table.rows.length,
      columnCount: table.columns.length,
      kind: table.kind,
      absorbedNodeIds: [...new Set(table.cells.flatMap((c) => c.contentNodeIds))],
    };
    nodes[node.id] = node;
    tableNodes.push(node);

    // Insert into reading order at first absorbed position
    const insertAt = findInsertIndex(semantic.readingOrder, node.absorbedNodeIds, readingOrder);
    readingOrder.splice(insertAt, 0, node.id);
  }

  // Update sections: remove absorbed children, add table nodes
  const sections = semantic.sections.map((section) => {
    const children = section.children
      .filter((c) => !absorbed.has(c.id))
      .map((c) => nodes[c.id] ?? c)
      .filter(Boolean);

    const pageTables = tableNodes.filter((t) =>
      t.absorbedNodeIds.some((id) =>
        section.children.some((c) => c.id === id) ||
        semantic.nodes[id]?.pageIndex === t.pageIndex,
      ),
    );

    for (const t of pageTables) {
      if (!children.some((c) => c.id === t.id)) {
        t.parentId = section.id;
        children.push(t);
      }
    }

    children.sort((a, b) => a.readingOrderIndex - b.readingOrderIndex);

    return {
      ...section,
      childIds: children.map((c) => c.id),
      children,
    };
  });

  const tableConfidence =
    tables.reduce((s, t) => s + t.confidence, 0) / Math.max(tables.length, 1);

  return {
    ...semantic,
    nodes,
    readingOrder,
    sections,
    quality: {
      ...semantic.quality,
      table: tableConfidence,
      overall: semantic.quality.overall * 0.9 + tableConfidence * 0.1,
    },
  };
}

function minReadingOrder(table: LogicalTable, semantic: SemanticDocument): number {
  let min = Infinity;
  for (const cell of table.cells) {
    for (const id of cell.contentNodeIds) {
      const n = semantic.nodes[id];
      if (n) min = Math.min(min, n.readingOrderIndex);
    }
  }
  return Number.isFinite(min) ? min : 0;
}

function findInsertIndex(
  originalOrder: string[],
  absorbedIds: string[],
  currentOrder: string[],
): number {
  const absorbed = new Set(absorbedIds);
  let firstOrig = Infinity;
  for (let i = 0; i < originalOrder.length; i++) {
    if (absorbed.has(originalOrder[i]!)) {
      firstOrig = i;
      break;
    }
  }
  if (!Number.isFinite(firstOrig)) return currentOrder.length;

  // Count how many non-absorbed nodes appear before firstOrig in original
  let count = 0;
  for (let i = 0; i < firstOrig; i++) {
    if (!absorbed.has(originalOrder[i]!)) count++;
  }
  return Math.min(count, currentOrder.length);
}
