import {
  bboxCenter,
  bboxContainsPoint,
  bboxIntersects,
  distance,
  type BoundingBox,
} from '../common/geometry.js';
import type { RawObjectType } from './raw-model.js';

export interface SpatialEntry {
  id: string;
  type: RawObjectType;
  bbox: BoundingBox;
  layer?: string;
  zIndex: number;
}

/**
 * Simple grid spatial index per page.
 * Supports nearest / rect / layer / type queries for the layout engine.
 */
export class PageSpatialIndex {
  private readonly entries: SpatialEntry[] = [];
  private readonly byId = new Map<string, SpatialEntry>();
  private readonly cellSize: number;
  private readonly grid = new Map<string, SpatialEntry[]>();

  constructor(cellSize = 72) {
    this.cellSize = cellSize;
  }

  insert(entry: SpatialEntry): void {
    this.entries.push(entry);
    this.byId.set(entry.id, entry);

    const cells = this.cellsFor(entry.bbox);
    for (const key of cells) {
      let bucket = this.grid.get(key);
      if (!bucket) {
        bucket = [];
        this.grid.set(key, bucket);
      }
      bucket.push(entry);
    }
  }

  get(id: string): SpatialEntry | undefined {
    return this.byId.get(id);
  }

  nearest(x: number, y: number, type?: RawObjectType): SpatialEntry | null {
    let best: SpatialEntry | null = null;
    let bestDist = Infinity;

    for (const entry of this.candidatesAround(x, y)) {
      if (type && entry.type !== type) continue;
      const c = bboxCenter(entry.bbox);
      const d = distance(x, y, c.x, c.y);
      if (d < bestDist) {
        bestDist = d;
        best = entry;
      }
    }

    // Fallback: linear scan if grid empty near point
    if (!best) {
      for (const entry of this.entries) {
        if (type && entry.type !== type) continue;
        const c = bboxCenter(entry.bbox);
        const d = distance(x, y, c.x, c.y);
        if (d < bestDist) {
          bestDist = d;
          best = entry;
        }
      }
    }

    return best;
  }

  objectsInRectangle(rect: BoundingBox, type?: RawObjectType): SpatialEntry[] {
    const seen = new Set<string>();
    const out: SpatialEntry[] = [];

    for (const key of this.cellsFor(rect)) {
      const bucket = this.grid.get(key);
      if (!bucket) continue;
      for (const entry of bucket) {
        if (seen.has(entry.id)) continue;
        if (type && entry.type !== type) continue;
        if (bboxIntersects(entry.bbox, rect)) {
          seen.add(entry.id);
          out.push(entry);
        }
      }
    }

    // Include entries that may span cells not visited when rect is tiny
    if (out.length === 0) {
      for (const entry of this.entries) {
        if (type && entry.type !== type) continue;
        if (bboxIntersects(entry.bbox, rect)) out.push(entry);
      }
    }

    return out.sort((a, b) => a.zIndex - b.zIndex);
  }

  objectsByLayer(layer: string): SpatialEntry[] {
    return this.entries.filter((e) => e.layer === layer);
  }

  objectsByType(type: RawObjectType): SpatialEntry[] {
    return this.entries.filter((e) => e.type === type);
  }

  objectsAtPoint(x: number, y: number): SpatialEntry[] {
    return this.entries
      .filter((e) => bboxContainsPoint(e.bbox, x, y))
      .sort((a, b) => b.zIndex - a.zIndex);
  }

  all(): SpatialEntry[] {
    return [...this.entries];
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

  private candidatesAround(x: number, y: number): SpatialEntry[] {
    const cx = Math.floor(x / this.cellSize);
    const cy = Math.floor(y / this.cellSize);
    const out: SpatialEntry[] = [];
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
