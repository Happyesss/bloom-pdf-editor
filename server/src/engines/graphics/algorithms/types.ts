import type { LayoutDocument } from '../../layout/types.js';
import type { RawDocument } from '../../parser/raw-model.js';
import type { SemanticDocument } from '../../semantic/types.js';
import type { TableDetectionResult } from '../../table/types.js';
import type {
  GraphicChart,
  GraphicGroup,
  GraphicImage,
  GraphicObject,
  GraphicVector,
  GraphicsModel,
} from '../types.js';

export interface GraphicsEngineInput {
  semantic: SemanticDocument;
  layout: LayoutDocument | null;
  raw: RawDocument;
  tables?: TableDetectionResult | null;
}

export interface IImageDetector {
  readonly name: string;
  detect(input: GraphicsEngineInput): GraphicImage[];
}

export interface IVectorDetector {
  readonly name: string;
  detect(input: GraphicsEngineInput): GraphicVector[];
}

export interface IChartAnalyzer {
  readonly name: string;
  analyze(
    vectors: GraphicVector[],
    images: GraphicImage[],
    input: GraphicsEngineInput,
  ): GraphicChart[];
}

export interface IGraphicsGrouper {
  readonly name: string;
  group(objects: GraphicObject[], input: GraphicsEngineInput): GraphicGroup[];
}

export interface IWrappingAnalyzer {
  readonly name: string;
  analyze(objects: GraphicObject[], input: GraphicsEngineInput): GraphicObject[];
}

export interface ICaptionLinker {
  readonly name: string;
  link(objects: GraphicObject[], input: GraphicsEngineInput): GraphicObject[];
}

export interface GraphicsStrategies {
  images: IImageDetector;
  vectors: IVectorDetector;
  charts: IChartAnalyzer;
  grouper: IGraphicsGrouper;
  wrapping: IWrappingAnalyzer;
  captions: ICaptionLinker;
}

export type { GraphicsModel };
