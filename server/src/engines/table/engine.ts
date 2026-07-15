import { createId } from '../../utils/id.js';
import type { LayoutDocument } from '../layout/types.js';
import type { RawDocument } from '../parser/raw-model.js';
import type { SemanticDocument } from '../semantic/types.js';
import type { TypographyAnalysis } from '../typography/types.js';
import { createDefaultTableStrategies } from './algorithms/defaults.js';
import type { TableEngineInput, TableStrategies } from './algorithms/types.js';
import { integrateTables } from './integrate.js';
import type {
  LogicalColumn,
  LogicalRow,
  LogicalTable,
  TableDetectionResult,
  TableGrid,
} from './types.js';

export interface TableDetectionEngineOptions {
  strategies?: Partial<TableStrategies>;
}

/**
 * Phase 7 — Table Detection & Reconstruction Engine.
 * Produces format-independent LogicalTable models. No DOCX/XLSX export.
 */
export class TableDetectionEngine {
  readonly name = 'TableDetectionEngine' as const;
  private readonly strategies: TableStrategies;

  constructor(options: TableDetectionEngineOptions = {}) {
    const defaults = createDefaultTableStrategies();
    this.strategies = { ...defaults, ...options.strategies };
  }

  async detect(input: {
    semantic: SemanticDocument;
    layout?: LayoutDocument | null;
    raw: RawDocument;
    typography: TypographyAnalysis;
  }): Promise<TableDetectionResult> {
    return this.DetectTables(input);
  }

  DetectTables(input: {
    semantic: SemanticDocument;
    layout?: LayoutDocument | null;
    raw: RawDocument;
    typography: TypographyAnalysis;
  }): TableDetectionResult {
    const ctx: TableEngineInput = {
      semantic: input.semantic,
      layout: input.layout ?? null,
      raw: input.raw,
      typography: input.typography,
    };

    const candidates = this.strategies.candidates.detect(ctx);
    const tables: LogicalTable[] = [];

    for (const candidate of candidates) {
      const grid = this.BuildGrid(candidate, ctx);
      if (!grid) continue;
      const table = this.GenerateLogicalTable(candidate, grid, ctx);
      if (table) tables.push(table);
    }

    // Best-effort multi-page continuation linking
    linkContinuedTables(tables);

    const semantic = integrateTables(input.semantic, tables);

    return {
      id: createId('tables'),
      tables,
      semantic,
    };
  }

  BuildGrid(
    candidate: Parameters<TableStrategies['grid']['build']>[0],
    input: TableEngineInput,
  ): TableGrid | null {
    return this.strategies.grid.build(candidate, input);
  }

  MergeCells(
    cells: Parameters<TableStrategies['merger']['merge']>[0],
    grid: TableGrid,
  ) {
    return this.strategies.merger.merge(cells, grid);
  }

  AnalyzeColumns(table: LogicalTable): LogicalTable {
    return this.strategies.columns.analyze(table);
  }

  AnalyzeRows(table: LogicalTable, input?: TableEngineInput): LogicalTable {
    if (!input) {
      // Role-only pass without typography context
      if (table.rows[0]) {
        table.rows[0].role = 'header';
        table.rows[0].confidence = 0.6;
        table.quality.header = 0.6;
      }
      return table;
    }
    return this.strategies.headers.annotate(table, input);
  }

  GenerateLogicalTable(
    candidate: Parameters<TableStrategies['grid']['build']>[0],
    grid: TableGrid,
    input: TableEngineInput,
  ): LogicalTable | null {
    let cells = this.strategies.cells.fill(grid, candidate, input);
    cells = this.strategies.merger.merge(cells, grid);

    const colCount = grid.xs.length - 1;
    const rowCount = grid.ys.length - 1;
    if (colCount < 2 || rowCount < 2) return null;

    // Need at least some filled cells
    const filled = cells.filter((c) => c.text.trim()).length;
    if (filled < 3) return null;

    const tableId = createId('table');
    for (const c of cells) c.parentId = tableId;

    const rows: LogicalRow[] = [];
    for (let r = 0; r < rowCount; r++) {
      const rowCells = cells.filter((c) => c.rowIndex === r);
      const height = rowCells[0]?.bbox.height ?? 0;
      const row: LogicalRow = {
        id: createId('trow'),
        parentId: tableId,
        childIds: rowCells.map((c) => c.id),
        rowIndex: r,
        height,
        role: 'body',
        confidence: 0.75,
      };
      rows.push(row);
      for (const c of rowCells) {
        if (!c.childIds) c.childIds = [];
      }
    }

    const columns: LogicalColumn[] = [];
    for (let c = 0; c < colCount; c++) {
      columns.push({
        id: createId('tcol'),
        parentId: tableId,
        colIndex: c,
        width: grid.xs[c + 1]! - grid.xs[c]!,
        minWidth: grid.xs[c + 1]! - grid.xs[c]!,
        maxWidth: grid.xs[c + 1]! - grid.xs[c]!,
        alignment: 'left',
        dataType: 'text',
        confidence: 0.7,
      });
    }

    let table: LogicalTable = {
      id: tableId,
      pageIndex: candidate.pageIndex,
      bbox: { ...candidate.bbox },
      kind: grid.kind,
      confidence: Math.min(0.95, candidate.score * 0.5 + grid.confidence * 0.5),
      rows,
      columns,
      cells,
      relationships: {},
      quality: {
        table: 0.75,
        row: 0.75,
        column: 0.7,
        cell: filled / Math.max(cells.length, 1),
        mergedCell: cells.some((c) => c.colSpan > 1 || c.rowSpan > 1) ? 0.7 : 0.5,
        header: 0.5,
      },
    };

    table = this.strategies.headers.annotate(table, input);
    table = this.strategies.columns.analyze(table);
    table.quality.table = table.confidence;
    table.quality.row =
      table.rows.reduce((s, r) => s + r.confidence, 0) / Math.max(table.rows.length, 1);

    return table;
  }
}

function linkContinuedTables(tables: LogicalTable[]): void {
  const byPage = new Map<number, LogicalTable[]>();
  for (const t of tables) {
    let arr = byPage.get(t.pageIndex);
    if (!arr) {
      arr = [];
      byPage.set(t.pageIndex, arr);
    }
    arr.push(t);
  }

  const pages = [...byPage.keys()].sort((a, b) => a - b);
  for (let i = 0; i < pages.length - 1; i++) {
    const a = byPage.get(pages[i]!)?.[0];
    const b = byPage.get(pages[i + 1]!)?.[0];
    if (!a || !b) continue;
    if (a.columns.length === b.columns.length) {
      const widthClose = Math.abs(a.bbox.width - b.bbox.width) < 20;
      const xClose = Math.abs(a.bbox.x - b.bbox.x) < 12;
      if (widthClose && xClose) {
        b.relationships.continuedFrom = a.id;
      }
    }
  }
}
