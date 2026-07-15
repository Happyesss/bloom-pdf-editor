import type { IHeaderDetector, TableEngineInput } from './algorithms/types.js';
import type { LogicalTable, RowRole } from './types.js';

export class HeaderDetector implements IHeaderDetector {
  readonly name = 'HeaderDetector';

  annotate(table: LogicalTable, input: TableEngineInput): LogicalTable {
    if (table.rows.length === 0) return table;

    const bodyMedian = bodyFontMedian(table, input);
    const first = table.rows[0]!;
    const firstCells = table.cells.filter((c) => c.rowIndex === 0);
    const firstSizes = firstCells.flatMap((c) =>
      c.runs.map((r) => r.fontSize ?? 0).filter((s) => s > 0),
    );
    const firstMedian = firstSizes.length
      ? firstSizes.sort((a, b) => a - b)[Math.floor(firstSizes.length / 2)]!
      : 0;
    const firstBold = firstCells.some((c) => c.runs.some((r) => r.bold));
    const firstLarger = firstMedian >= bodyMedian * 1.12 && firstMedian > 0;

    if (firstBold || firstLarger || table.kind === 'bordered') {
      first.role = 'header';
      first.confidence = firstBold || firstLarger ? 0.85 : 0.65;
      table.quality.header = first.confidence;
    }

    // Summary row heuristic
    const last = table.rows[table.rows.length - 1]!;
    if (last.rowIndex !== first.rowIndex) {
      const lastCells = table.cells.filter((c) => c.rowIndex === last.rowIndex);
      const texts = lastCells.map((c) => c.text);
      const numericish = texts.filter((t) => /[\d$€£%]/.test(t)).length;
      const hasTotal = texts.some((t) => /\b(total|sum|subtotal)\b/i.test(t));
      if (hasTotal || (numericish >= Math.ceil(lastCells.length * 0.6) && lastCells.some((c) => c.runs.some((r) => r.bold)))) {
        last.role = 'summary';
        last.confidence = 0.75;
      }
    }

    // Ensure body role
    for (const row of table.rows) {
      if (!row.role) row.role = 'body' as RowRole;
      if (row.role === 'header' || row.role === 'summary') continue;
      row.role = 'body';
    }

    return table;
  }
}

function bodyFontMedian(table: LogicalTable, _input: TableEngineInput): number {
  // Prefer non-first-row cell fonts so a larger header does not skew the baseline.
  const fromBody: number[] = [];
  const fromAll: number[] = [];
  for (const c of table.cells) {
    for (const r of c.runs) {
      if (!r.fontSize) continue;
      fromAll.push(r.fontSize);
      if (c.rowIndex > 0) fromBody.push(r.fontSize);
    }
  }
  const sample = fromBody.length ? fromBody : fromAll;
  if (sample.length === 0) return 12;
  sample.sort((a, b) => a - b);
  return sample[Math.floor(sample.length / 2)]!;
}
