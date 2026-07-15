import { createId } from '../../utils/id.js';
import type { BoundingBox } from '../common/geometry.js';
import type { GraphicsEngineInput, IGraphicsGrouper } from './algorithms/types.js';
import type { GraphicGroup, GraphicObject } from './types.js';

/**
 * Cluster nearby graphics into groups (supports nested groups via proximity).
 */
export class GraphicsGrouper implements IGraphicsGrouper {
  readonly name = 'GraphicsGrouper';

  group(objects: GraphicObject[], _input: GraphicsEngineInput): GraphicGroup[] {
    const candidates = objects.filter((o) => o.kind !== 'group' && o.kind !== 'chart');
    const byPage = new Map<number, GraphicObject[]>();
    for (const o of candidates) {
      let arr = byPage.get(o.pageIndex);
      if (!arr) {
        arr = [];
        byPage.set(o.pageIndex, arr);
      }
      arr.push(o);
    }

    const groups: GraphicGroup[] = [];
    for (const [pageIndex, pageObjs] of byPage) {
      const used = new Set<string>();
      for (const seed of pageObjs) {
        if (used.has(seed.id)) continue;
        const cluster = [seed];
        used.add(seed.id);
        for (const other of pageObjs) {
          if (used.has(other.id)) continue;
          if (near(seed.bbox, other.bbox, 12)) {
            cluster.push(other);
            used.add(other.id);
          }
        }
        if (cluster.length < 2) continue;

        const group: GraphicGroup = {
          id: createId('ggrp'),
          kind: 'group',
          pageIndex,
          bbox: union(cluster.map((c) => c.bbox)),
          rotation: 0,
          opacity: 1,
          zIndex: Math.max(...cluster.map((c) => c.zIndex)),
          parentId: null,
          childIds: cluster.map((c) => c.id),
          wrap: 'square',
          sourceIds: cluster.flatMap((c) => c.sourceIds),
          confidence: 0.7,
          nested: cluster.some((c) => c.kind === 'group'),
        };
        for (const c of cluster) {
          c.parentId = group.id;
        }
        groups.push(group);
      }
    }
    return groups;
  }
}

function near(a: BoundingBox, b: BoundingBox, gap: number): boolean {
  const ax1 = a.x - gap;
  const ay1 = a.y - gap;
  const ax2 = a.x + a.width + gap;
  const ay2 = a.y + a.height + gap;
  return !(b.x + b.width < ax1 || b.x > ax2 || b.y + b.height < ay1 || b.y > ay2);
}

function union(boxes: BoundingBox[]): BoundingBox {
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
