import type { BoundingBox } from '../../common/geometry.js';
import type { RawPage } from '../../parser/raw-model.js';
import type {
  ClusteredObject,
  LayoutBlock,
  LayoutRegion,
  LayoutRegionKind,
  NormalizedPage,
  ReadingOrderGraph,
  SegmentCandidate,
  WhitespaceSignals,
} from '../types.js';

/** Swappable layout algorithms — public LayoutEngine API stays stable. */

export interface ICoordinateNormalizer {
  readonly name: string;
  normalize(page: RawPage): {
    normalized: NormalizedPage;
    characters: NormalizedChar[];
    images: NormalizedImage[];
    vectors: NormalizedShape[];
    annotations: NormalizedShape[];
    forms: NormalizedShape[];
  };
}

export interface NormalizedChar {
  id: string;
  bbox: BoundingBox;
  unicode: string;
  fontName: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  baseline: number;
  writingDirection: 'ltr' | 'rtl' | 'ttb';
  rotation: number;
}

export interface NormalizedImage {
  id: string;
  bbox: BoundingBox;
  rotation: number;
}

export interface NormalizedShape {
  id: string;
  bbox: BoundingBox;
  kind: 'vector' | 'annotation' | 'form';
}

export type LayoutObjectType =
  | 'character'
  | 'word'
  | 'line'
  | 'text_cluster'
  | 'image'
  | 'vector'
  | 'annotation'
  | 'form';

export interface LayoutSpatialEntry {
  id: string;
  type: LayoutObjectType;
  bbox: BoundingBox;
  layer?: string;
  fontName?: string;
  fontSize?: number;
  fontWeight?: number;
  styleKey?: string;
  zIndex: number;
}

export interface ILayoutSpatialIndex {
  readonly name: string;
  clear(): void;
  insert(entry: LayoutSpatialEntry): void;
  nearest(x: number, y: number, type?: LayoutObjectType): LayoutSpatialEntry | null;
  objectsInsideRectangle(rect: BoundingBox, type?: LayoutObjectType): LayoutSpatialEntry[];
  objectsIntersectingRectangle(rect: BoundingBox, type?: LayoutObjectType): LayoutSpatialEntry[];
  objectsByType(type: LayoutObjectType): LayoutSpatialEntry[];
  objectsByLayer(layer: string): LayoutSpatialEntry[];
  objectsByFont(fontName: string): LayoutSpatialEntry[];
  objectsByStyle(styleKey: string): LayoutSpatialEntry[];
  all(): LayoutSpatialEntry[];
}

export interface IObjectClusterer {
  readonly name: string;
  cluster(input: {
    pageIndex: number;
    characters: NormalizedChar[];
    images: NormalizedImage[];
    vectors: NormalizedShape[];
    annotations: NormalizedShape[];
    forms: NormalizedShape[];
    index: ILayoutSpatialIndex;
  }): { clusters: ClusteredObject[]; blocks: LayoutBlock[] };
}

export interface IWhitespaceAnalyzer {
  readonly name: string;
  analyze(input: {
    pageWidth: number;
    pageHeight: number;
    clusters: ClusteredObject[];
  }): WhitespaceSignals;
}

export interface IPageSegmenter {
  readonly name: string;
  segment(input: {
    pageWidth: number;
    pageHeight: number;
    blocks: LayoutBlock[];
    whitespace: WhitespaceSignals;
  }): SegmentCandidate[];
}

export interface IRegionClassifier {
  readonly name: string;
  classify(input: {
    pageWidth: number;
    pageHeight: number;
    segments: SegmentCandidate[];
    blocks: LayoutBlock[];
    medianFontSize: number;
    writingDirection: NormalizedPage['writingDirection'];
  }): LayoutRegion[];
}

export interface IReadingOrderBuilder {
  readonly name: string;
  build(input: {
    pageWidth: number;
    pageHeight: number;
    regions: LayoutRegion[];
    whitespace: WhitespaceSignals;
    writingDirection: NormalizedPage['writingDirection'];
  }): ReadingOrderGraph;
}

export interface LayoutStrategies {
  normalizer: ICoordinateNormalizer;
  createSpatialIndex: () => ILayoutSpatialIndex;
  clusterer: IObjectClusterer;
  whitespace: IWhitespaceAnalyzer;
  segmenter: IPageSegmenter;
  classifier: IRegionClassifier;
  readingOrder: IReadingOrderBuilder;
}

/** Ensure Phase 3 never emits forbidden kinds. */
export const FORBIDDEN_REGION_KINDS = new Set<string>(['paragraph', 'table']);

export function assertAllowedRegionKind(kind: LayoutRegionKind): void {
  if (FORBIDDEN_REGION_KINDS.has(kind)) {
    throw new Error(`Phase 3 forbids region kind: ${kind}`);
  }
}
