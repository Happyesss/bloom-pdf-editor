import type { IColumnAnalyzer } from './algorithms/types.js';
import type { CellAlignment, ColumnDataType, LogicalTable } from './types.js';

const DATE_RE =
  /^\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}$|^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}/i;
const CURRENCY_RE = /^[$€£¥]\s?-?[\d,]+\.?\d*$|^-?[\d,]+\.?\d*\s?[$€£¥]$/;
const PERCENT_RE = /^-?[\d,]+\.?\d*\s*%$/;
const NUMERIC_RE = /^-?[\d,]+\.?\d*$/;

export class ColumnAnalyzer implements IColumnAnalyzer {
  readonly name = 'ColumnAnalyzer';

  analyze(table: LogicalTable): LogicalTable {
    for (const col of table.columns) {
      const bodyCells = table.cells.filter((c) => {
        if (c.colIndex !== col.colIndex) return false;
        const row = table.rows.find((r) => r.rowIndex === c.rowIndex);
        return row?.role !== 'header';
      });
      const allCol = table.cells.filter((c) => c.colIndex === col.colIndex);
      const sample = (bodyCells.length ? bodyCells : allCol)
        .map((c) => c.text.trim())
        .filter(Boolean);

      col.dataType = majorityType(sample);
      col.alignment = majorityAlign(
        table.cells.filter((c) => c.colIndex === col.colIndex).map((c) => c.alignment),
      );
      col.confidence = sample.length ? 0.8 : 0.5;

      const widths = table.cells
        .filter((c) => c.colIndex === col.colIndex)
        .map((c) => c.bbox.width);
      if (widths.length) {
        col.width = average(widths);
        col.minWidth = Math.min(...widths);
        col.maxWidth = Math.max(...widths);
      }
    }

    table.quality.column =
      table.columns.reduce((s, c) => s + c.confidence, 0) /
      Math.max(table.columns.length, 1);

    return table;
  }
}

function majorityType(texts: string[]): ColumnDataType {
  if (texts.length === 0) return 'text';
  const counts: Record<ColumnDataType, number> = {
    text: 0,
    numeric: 0,
    currency: 0,
    date: 0,
    percentage: 0,
  };
  for (const t of texts) {
    if (PERCENT_RE.test(t)) counts.percentage++;
    else if (CURRENCY_RE.test(t)) counts.currency++;
    else if (DATE_RE.test(t)) counts.date++;
    else if (NUMERIC_RE.test(t)) counts.numeric++;
    else counts.text++;
  }
  let best: ColumnDataType = 'text';
  let n = -1;
  for (const [k, v] of Object.entries(counts) as Array<[ColumnDataType, number]>) {
    if (v > n) {
      n = v;
      best = k;
    }
  }
  return best;
}

function majorityAlign(aligns: CellAlignment[]): CellAlignment {
  const counts = new Map<CellAlignment, number>();
  for (const a of aligns) counts.set(a, (counts.get(a) ?? 0) + 1);
  let best: CellAlignment = 'left';
  let n = -1;
  for (const [a, v] of counts) {
    if (v > n) {
      n = v;
      best = a;
    }
  }
  return best;
}

function average(nums: number[]): number {
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
