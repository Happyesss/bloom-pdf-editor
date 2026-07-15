import type { LayoutDocument } from '../../layout/types.js';
import type { RawDocument } from '../../parser/raw-model.js';
import type { SemanticDocument } from '../../semantic/types.js';
import type { TypographyAnalysis } from '../../typography/types.js';
import type {
  LogicalCell,
  LogicalTable,
  TableCandidate,
  TableGrid,
} from '../types.js';

export interface TableEngineInput {
  semantic: SemanticDocument;
  layout: LayoutDocument | null;
  raw: RawDocument;
  typography: TypographyAnalysis;
}

export interface ITableCandidateDetector {
  readonly name: string;
  detect(input: TableEngineInput): TableCandidate[];
}

export interface IGridBuilder {
  readonly name: string;
  build(candidate: TableCandidate, input: TableEngineInput): TableGrid | null;
}

export interface ICellFiller {
  readonly name: string;
  fill(
    grid: TableGrid,
    candidate: TableCandidate,
    input: TableEngineInput,
  ): LogicalCell[];
}

export interface ICellMerger {
  readonly name: string;
  merge(cells: LogicalCell[], grid: TableGrid): LogicalCell[];
}

export interface IHeaderDetector {
  readonly name: string;
  annotate(table: LogicalTable, input: TableEngineInput): LogicalTable;
}

export interface IColumnAnalyzer {
  readonly name: string;
  analyze(table: LogicalTable): LogicalTable;
}

export interface TableStrategies {
  candidates: ITableCandidateDetector;
  grid: IGridBuilder;
  cells: ICellFiller;
  merger: ICellMerger;
  headers: IHeaderDetector;
  columns: IColumnAnalyzer;
}
