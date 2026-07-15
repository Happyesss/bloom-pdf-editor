/** Axis-aligned bounding box in PDF user space (points). */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 3×3 affine transform stored as PDF CTM [a b c d e f]. */
export type Matrix2D = readonly [number, number, number, number, number, number];

export const IDENTITY_MATRIX: Matrix2D = [1, 0, 0, 1, 0, 0];

export function multiplyMatrix(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + b1 * c2,
    a1 * b2 + b1 * d2,
    c1 * a2 + d1 * c2,
    c1 * b2 + d1 * d2,
    e1 * a2 + f1 * c2 + e2,
    e1 * b2 + f1 * d2 + f2,
  ];
}

export function transformPoint(
  m: Matrix2D,
  x: number,
  y: number,
): { x: number; y: number } {
  const [a, b, c, d, e, f] = m;
  return {
    x: a * x + c * y + e,
    y: b * x + d * y + f,
  };
}

export function emptyBBox(): BoundingBox {
  return { x: 0, y: 0, width: 0, height: 0 };
}

export function bboxFromPoints(
  points: ReadonlyArray<{ x: number; y: number }>,
): BoundingBox {
  if (points.length === 0) return emptyBBox();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

export function bboxIntersects(a: BoundingBox, b: BoundingBox): boolean {
  return !(
    a.x + a.width < b.x ||
    b.x + b.width < a.x ||
    a.y + a.height < b.y ||
    b.y + b.height < a.y
  );
}

export function bboxContainsPoint(b: BoundingBox, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height;
}

export function bboxCenter(b: BoundingBox): { x: number; y: number } {
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx;
  const dy = ay - by;
  return Math.hypot(dx, dy);
}
