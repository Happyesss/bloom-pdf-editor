/**
 * Build a spatial index from interpreter display list items for selection.
 */

import type { DisplayItem, PathItem, ImageItem, TextRun } from '../content/interpreter';
import { QuadTree, type SpatialEntry } from './spatial-index';

export type SelectableItem = PathItem | ImageItem | TextRun;

export function buildDisplayListIndex(
  items: DisplayItem[],
  pageBounds: { x: number; y: number; width: number; height: number },
): QuadTree<SelectableItem> {
  const tree = new QuadTree<SelectableItem>(pageBounds);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type === 'text' || item.type === 'path' || item.type === 'image') {
      tree.insert({
        id: `${item.type}-${i}`,
        bounds: { x: item.x, y: item.y, width: item.width, height: item.height },
        data: item,
      });
    }
  }

  return tree;
}

export function hitTestDisplayList(
  tree: QuadTree<SelectableItem>,
  pdfX: number,
  pdfY: number,
): SpatialEntry<SelectableItem> | null {
  const hits = tree.queryPoint(pdfX, pdfY);
  return hits.length > 0 ? hits[hits.length - 1] : null;
}
