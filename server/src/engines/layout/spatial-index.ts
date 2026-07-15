import {
  bboxCenter,
  bboxContainsPoint,
  bboxIntersects,
  distance,
  type BoundingBox,
} from '../common/geometry.js';
import type {
  ILayoutSpatialIndex,
  LayoutObjectType,
  LayoutSpatialEntry,
} from './algorithms/types.js';

/**
 * Grid spatial index for layout analysis.
 * Extends Phase 2 query surface with font / style / intersecting lookups.
 */
export class LayoutSpatialIndex implements ILayoutSpatialIndex {
  readonly name = 'LayoutSpatialIndex';

  private readonly entries: LayoutSpatialEntry[] = [];
  private readonly byId = new Map<string, LayoutSpatialEntry>();
  private readonly grid = new Map<string, LayoutSpatialEntry[]>();
  private readonly byFont = new Map<string, LayoutSpatialEntry[]>();
  private readonly byStyle = new Map<string, LayoutSpatialEntry[]>();
  private readonly byLayer = new Map<string, LayoutSpatialEntry[]>();
  private readonly byType = new Map<LayoutObjectType, LayoutSpatialEntry[]>();

  constructor(private readonly cellSize = 72) {}

  clear(): void {
    this.entries.length = 0;
    this.byId.clear();
    this.grid.clear();
    this.byFont.clear();
    this.byStyle.clear();
    this.byLayer.clear();
    this.byType.clear();
  }

  insert(entry: LayoutSpatialEntry): void {
    this.entries.push(entry);
    this.byId.set(entry.id, entry);

    for (const key of this.cellsFor(entry.bbox)) {
      let bucket = this.grid.get(key);
      if (!bucket) {
        bucket = [];
        this.grid.set(key, bucket);
      }
      bucket.push(entry);
    }

    pushMap(this.byType, entry.type, entry);
    if (entry.fontName) pushMap(this.byFont, entry.fontName, entry);
    if (entry.styleKey) pushMap(this.byStyle, entry.styleKey, entry);
    if (entry.layer) pushMap(this.byLayer, entry.layer, entry);
  }

  nearest(x: number, y: number, type?: LayoutObjectType): LayoutSpatialEntry | null {
    let best: LayoutSpatialEntry | null = null;
    let bestDist = Infinity;

    const candidates = this.candidatesAround(x, y);
    const pool = candidates.length > 0 ? candidates : this.entries;

    for (const entry of pool) {
      if (type && entry.type !== type) continue;
      const c = bboxCenter(entry.bbox);
      const d = distance(x, y, c.x, c.y);
      if (d < bestDist) {
        bestDist = d;
        best = entry;
      }
    }
    return best;
  }

  objectsInsideRectangle(rect: BoundingBox, type?: LayoutObjectType): LayoutSpatialEntry[] {
    return this.queryRect(rect, type, 'inside');
  }

  objectsIntersectingRectangle(rect: BoundingBox, type?: LayoutObjectType): LayoutSpatialEntry[] {
    return this.queryRect(rect, type, 'intersect');
  }

  objectsByType(type: LayoutObjectType): LayoutSpatialEntry[] {
    return [...(this.byType.get(type) ?? [])];
  }

  objectsByLayer(layer: string): LayoutSpatialEntry[] {
    return [...(this.byLayer.get(layer) ?? [])];
  }

  objectsByFont(fontName: string): LayoutSpatialEntry[] {
    return [...(this.byFont.get(fontName) ?? [])];
  }

  objectsByStyle(styleKey: string): LayoutSpatialEntry[] {
    return [...(this.byStyle.get(styleKey) ?? [])];
  }

  all(): LayoutSpatialEntry[] {
    return [...this.entries];
  }

  private queryRect(
    rect: BoundingBox,
    type: LayoutObjectType | undefined,
    mode: 'inside' | 'intersect',
  ): LayoutSpatialEntry[] {
    const seen = new Set<string>();
    const out: LayoutSpatialEntry[] = [];

    const consider = (entry: LayoutSpatialEntry) => {
      if (seen.has(entry.id)) return;
      if (type && entry.type !== type) return;
      const ok =
        mode === 'inside'
          ? bboxFullyInside(entry.bbox, rect)
          : bboxIntersects(entry.bbox, rect);
      if (!ok) return;
      seen.add(entry.id);
      out.push(entry);
    };

    for (const key of this.cellsFor(rect)) {
      const bucket = this.grid.get(key);
      if (!bucket) continue;
      for (const entry of bucket) consider(entry);
    }

    if (out.length === 0) {
      for (const entry of this.entries) consider(entry);
    }

    return out.sort((a, b) => a.zIndex - b.zIndex);
  }

  private cellsFor(bbox: BoundingBox): string[] {
    const x0 = Math.floor(bbox.x / this.cellSize);
    const y0 = Math.floor(bbox.y / this.cellSize);
    const x1 = Math.floor((bbox.x + Math.max(bbox.width, 0.001)) / this.cellSize);
    const y1 = Math.floor((bbox.y + Math.max(bbox.height, 0.001)) / this.cellSize);
    const keys: string[] = [];
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        keys.push(`${x}:${y}`);
      }
    }
    return keys;
  }

  private candidatesAround(x: number, y: number): LayoutSpatialEntry[] {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const out: LayoutSpatialEntry[] = [];
    const seen = new Set<string>();
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const bucket = this.grid.get(`${cx + dx}:${cy + dy}`);
        if (!bucket) continue;
        for (const e of bucket) {
          if (!seen.has(e.id)) {
            seen.add(e.id);
            out.push(e);
          }
        }
      }
    }
    return out;
  }
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  let arr = map.get(key);
  if (!arr) {
    arr = [];
    map.set(key, arr);
  }
  arr.push(value);
}

function bboxFullyInside(inner: BoundingBox, outer: BoundingBox): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** @internal test helper */
export function pointInIndex(index: ILayoutSpatialIndex, x: number, y: number): boolean {
  return index.all().some((e) => bboxContainsPoint(e.bbox, x, y));
}
