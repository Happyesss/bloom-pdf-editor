import type { BoundingBox, Matrix2D } from '../common/geometry.js';
import type { ColorValue } from '../parser/raw-model.js';

/** Phase 8 — format-independent graphics model (not DOCX/PPTX/SVG export). */

export type GraphicKind = 'image' | 'vector' | 'chart' | 'shape' | 'group';
export type VectorShapeKind =
  | 'line'
  | 'rectangle'
  | 'rounded_rectangle'
  | 'circle'
  | 'ellipse'
  | 'polygon'
  | 'bezier'
  | 'path'
  | 'compound_path'
  | 'clipping_path'
  | 'unknown';
export type ChartKind =
  | 'bar'
  | 'pie'
  | 'line'
  | 'area'
  | 'scatter'
  | 'flow'
  | 'smartart'
  | 'unknown';
export type WrapMode =
  | 'inline'
  | 'square'
  | 'tight'
  | 'behind'
  | 'in_front'
  | 'floating'
  | 'anchored';

export interface GraphicStyle {
  strokeWidth?: number;
  strokeColor?: ColorValue | null;
  fillColor?: ColorValue | null;
  opacity?: number;
  dashPattern?: number[];
  joinStyle?: number;
  capStyle?: number;
  blendMode?: string;
}

export interface GraphicBase {
  id: string;
  kind: GraphicKind;
  pageIndex: number;
  bbox: BoundingBox;
  transform?: Matrix2D;
  rotation: number;
  opacity: number;
  layer?: string;
  zIndex: number;
  parentId: string | null;
  childIds: string[];
  wrap: WrapMode;
  anchorId?: string;
  captionId?: string;
  sourceIds: string[];
  confidence: number;
}

export interface GraphicImage extends GraphicBase {
  kind: 'image';
  imageType: string;
  widthPx: number;
  heightPx: number;
  dpi: number;
  compression: string | null;
  colorSpace: string | null;
  hasTransparency: boolean;
  resourceName: string | null;
  /** Resource fingerprint for dedupe — never stores image bytes. */
  resourceKey: string;
}

export interface GraphicVector extends GraphicBase {
  kind: 'vector';
  shape: VectorShapeKind;
  style: GraphicStyle;
  pathCommandCount: number;
  closed: boolean;
}

export interface GraphicChart extends GraphicBase {
  kind: 'chart';
  chartKind: ChartKind;
  seriesCount: number;
  editableCandidate: boolean;
  memberIds: string[];
}

export interface GraphicShape extends GraphicBase {
  kind: 'shape';
  shape: VectorShapeKind;
  style: GraphicStyle;
}

export interface GraphicGroup extends GraphicBase {
  kind: 'group';
  nested: boolean;
}

export type GraphicObject =
  | GraphicImage
  | GraphicVector
  | GraphicChart
  | GraphicShape
  | GraphicGroup;

export interface GraphicsQualityScores {
  image: number;
  vector: number;
  chart: number;
  shape: number;
  grouping: number;
  wrapping: number;
  overall: number;
}

export interface GraphicsResourceIndex {
  images: Record<string, { resourceKey: string; refs: string[] }>;
  patterns: string[];
  gradients: string[];
}

export interface GraphicsModel {
  id: string;
  sourceDocumentId: string;
  objects: GraphicObject[];
  /** Top-level reading/z order ids (groups preferred over members). */
  rootIds: string[];
  resources: GraphicsResourceIndex;
  quality: GraphicsQualityScores;
}

export interface GraphicsReconstructionResult {
  id: string;
  graphics: GraphicsModel;
}
