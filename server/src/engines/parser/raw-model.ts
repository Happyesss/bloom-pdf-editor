import type { BoundingBox, Matrix2D } from '../common/geometry.js';
import type { ObjectGraph } from './object-graph.js';
import type { PageSpatialIndex } from './spatial-index.js';

export type RawObjectType =
  | 'character'
  | 'glyph'
  | 'textRun'
  | 'word'
  | 'image'
  | 'vector'
  | 'annotation'
  | 'form'
  | 'bookmark'
  | 'font'
  | 'page'
  | 'document';

export interface RawObjectBase {
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

export interface RawCharacter extends RawObjectBase {
  type: 'character';
  unicode: string;
  glyphId: number;
  width: number;
  height: number;
  rotation: number;
  fontName: string;
  fontSize: number;
  fontWeight: number;
  italic: boolean;
  fillColor: ColorValue | null;
  strokeColor: ColorValue | null;
  characterSpacing: number;
  wordSpacing: number;
  renderingMode: number;
  writingDirection: 'ltr' | 'rtl' | 'ttb';
}

export interface RawTextRun extends RawObjectBase {
  type: 'textRun';
  text: string;
  fontName: string;
  fontSize: number;
  characterIds: string[];
  fillColor: ColorValue | null;
}

export interface RawWord extends RawObjectBase {
  type: 'word';
  text: string;
  characterIds: string[];
}

export interface RawImage extends RawObjectBase {
  type: 'image';
  imageType: string;
  widthPx: number;
  heightPx: number;
  dpi: number;
  compression: string | null;
  colorSpace: string | null;
  hasTransparency: boolean;
  rotation: number;
  resourceName: string | null;
  data?: Uint8Array;
}

export type PathCommand =
  | { op: 'm'; x: number; y: number }
  | { op: 'l'; x: number; y: number }
  | { op: 'c'; x1: number; y1: number; x2: number; y2: number; x3: number; y3: number }
  | { op: 'v'; x2: number; y2: number; x3: number; y3: number }
  | { op: 'y'; x1: number; y1: number; x3: number; y3: number }
  | { op: 'h' }
  | { op: 're'; x: number; y: number; w: number; h: number };

export interface RawVector extends RawObjectBase {
  type: 'vector';
  pathCommands: PathCommand[];
  strokeWidth: number;
  strokeColor: ColorValue | null;
  fillColor: ColorValue | null;
  dashPattern: number[];
  joinStyle: number;
  capStyle: number;
  opacity: number;
  paint: 'stroke' | 'fill' | 'fillStroke' | 'clip' | 'none';
}

export interface RawAnnotation extends RawObjectBase {
  type: 'annotation';
  subtype: string;
  contents: string | null;
  uri: string | null;
  dest: unknown;
}

export interface RawForm extends RawObjectBase {
  type: 'form';
  fieldName: string;
  fieldType: string;
  value: string | null;
}

export interface RawBookmark {
  id: string;
  title: string;
  pageIndex: number;
  children?: RawBookmark[];
}

export interface RawFont {
  id: string;
  name: string;
  baseFont: string;
  subtype: string | null;
  encoding: string | null;
}

export type ColorValue =
  | { space: 'DeviceGray'; values: [number] }
  | { space: 'DeviceRGB'; values: [number, number, number] }
  | { space: 'DeviceCMYK'; values: [number, number, number, number] }
  | { space: string; values: number[] };

export interface RawPageBox {
  mediaBox: BoundingBox;
  cropBox: BoundingBox;
  bleedBox: BoundingBox | null;
  trimBox: BoundingBox | null;
  artBox: BoundingBox | null;
}

export interface RawPage {
  id: string;
  index: number;
  width: number;
  height: number;
  rotation: number;
  boxes: RawPageBox;
  resources: Record<string, unknown>;
  characters: RawCharacter[];
  textRuns: RawTextRun[];
  words: RawWord[];
  images: RawImage[];
  vectors: RawVector[];
  annotations: RawAnnotation[];
  forms: RawForm[];
  fonts: RawFont[];
  spatialIndex: PageSpatialIndex;
}

export interface RawDocumentMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  creator?: string;
  producer?: string;
  creationDate?: string;
  modificationDate?: string;
  pdfVersion?: string;
}

export interface RawDocument {
  id: string;
  metadata: RawDocumentMetadata;
  pages: RawPage[];
  bookmarks: RawBookmark[];
  objectGraph: ObjectGraph;
  /** Original byte length for telemetry. */
  sourceBytes: number;
}
