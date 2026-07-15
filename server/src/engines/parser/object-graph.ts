import type { BoundingBox, Matrix2D } from '../common/geometry.js';
import type { RawObjectType } from './raw-model.js';

export interface GraphNode {
  id: string;
  type: RawObjectType;
  parentId: string | null;
  childIds: string[];
  pageIndex: number;
  bbox: BoundingBox;
  transform: Matrix2D;
  zIndex: number;
  layer?: string;
}

/**
 * Directed object graph for every extracted raw object.
 * Layout engine (Phase 3) walks this graph — never the PDF COS tree.
 */
export class ObjectGraph {
  private readonly nodes = new Map<string, GraphNode>();

  get size(): number {
    return this.nodes.size;
  }

  add(node: GraphNode): void {
    this.nodes.set(node.id, {
      ...node,
      childIds: [...node.childIds],
    });

    if (node.parentId) {
      const parent = this.nodes.get(node.parentId);
      if (parent && !parent.childIds.includes(node.id)) {
        parent.childIds.push(node.id);
      }
    }
  }

  get(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  has(id: string): boolean {
    return this.nodes.has(id);
  }

  children(id: string): GraphNode[] {
    const node = this.nodes.get(id);
    if (!node) return [];
    return node.childIds
      .map((cid) => this.nodes.get(cid))
      .filter((n): n is GraphNode => n != null);
  }

  parent(id: string): GraphNode | undefined {
    const node = this.nodes.get(id);
    if (!node?.parentId) return undefined;
    return this.nodes.get(node.parentId);
  }

  byPage(pageIndex: number): GraphNode[] {
    return [...this.nodes.values()].filter((n) => n.pageIndex === pageIndex);
  }

  byType(type: RawObjectType): GraphNode[] {
    return [...this.nodes.values()].filter((n) => n.type === type);
  }

  all(): GraphNode[] {
    return [...this.nodes.values()];
  }

  toJSON(): GraphNode[] {
    return this.all();
  }
}
