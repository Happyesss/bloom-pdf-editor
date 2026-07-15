import type { IntermediateDocument } from '../../idm/types.js';
import type { LayoutDocument } from '../../layout/types.js';
import type { RawDocument } from '../../parser/raw-model.js';
import type { SemanticDocument } from '../../semantic/types.js';
import type { GraphicsModel } from '../../graphics/types.js';
import type { LogicalTable } from '../../table/types.js';
import type {
  BookmarkNode,
  DocumentStructureModel,
  FootnoteEntry,
  HyperlinkEntry,
  PageNumberEntry,
  RunningRegion,
  StructureNode,
  TocEntry,
} from '../types.js';

export interface StructureEngineInput {
  semantic: SemanticDocument;
  tables: LogicalTable[];
  graphics: GraphicsModel | null;
  layout: LayoutDocument | null;
  raw: RawDocument;
  idm: IntermediateDocument;
}

export interface IRunningRegionDetector {
  readonly name: string;
  detectHeaders(input: StructureEngineInput): RunningRegion[];
  detectFooters(input: StructureEngineInput): RunningRegion[];
}

export interface IPageNumberDetector {
  readonly name: string;
  detect(input: StructureEngineInput, footers: RunningRegion[]): PageNumberEntry[];
}

export interface IFootnoteDetector {
  readonly name: string;
  detect(input: StructureEngineInput): { footnotes: FootnoteEntry[]; endnotes: FootnoteEntry[] };
}

export interface ITocDetector {
  readonly name: string;
  detect(input: StructureEngineInput): TocEntry[];
}

export interface IBookmarkBuilder {
  readonly name: string;
  build(input: StructureEngineInput): BookmarkNode[];
}

export interface IHyperlinkAnalyzer {
  readonly name: string;
  analyze(input: StructureEngineInput): HyperlinkEntry[];
}

export interface ISectionHierarchyBuilder {
  readonly name: string;
  build(input: StructureEngineInput): { root: StructureNode; nodes: Record<string, StructureNode> };
}

export interface StructureStrategies {
  running: IRunningRegionDetector;
  pageNumbers: IPageNumberDetector;
  footnotes: IFootnoteDetector;
  toc: ITocDetector;
  bookmarks: IBookmarkBuilder;
  hyperlinks: IHyperlinkAnalyzer;
  sections: ISectionHierarchyBuilder;
}

export type { DocumentStructureModel };
