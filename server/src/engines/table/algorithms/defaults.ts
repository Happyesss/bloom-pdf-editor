import { TableCandidateDetector } from '../candidates.js';
import { CellFiller, CellMerger } from '../cells.js';
import { ColumnAnalyzer } from '../columns.js';
import { GridBuilder } from '../grid.js';
import { HeaderDetector } from '../headers.js';
import type { TableStrategies } from './types.js';

export function createDefaultTableStrategies(): TableStrategies {
  return {
    candidates: new TableCandidateDetector(),
    grid: new GridBuilder(),
    cells: new CellFiller(),
    merger: new CellMerger(),
    headers: new HeaderDetector(),
    columns: new ColumnAnalyzer(),
  };
}
