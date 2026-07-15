import type { LogicalTable } from '../../table/types.js';

/** Infer SUM formulas for summary rows on numeric columns. */
export function inferSummaryFormulas(table: LogicalTable): Map<string, string> {
  const out = new Map<string, string>();
  if (table.rows.length < 2) return out;

  const last = table.rows[table.rows.length - 1]!;
  const lastCells = table.cells.filter((c) => c.rowIndex === last.rowIndex);
  const looksSummary =
    last.role === 'summary' ||
    lastCells.some((c) => /\b(total|sum|subtotal)\b/i.test(c.text));
  if (!looksSummary) return out;

  const headerCount = table.rows.filter((r) => r.role === 'header').length;
  const bodyStart = headerCount; // 0-based row index in sheet (same as table)
  const bodyEnd = last.rowIndex - 1; // inclusive table row index before summary
  if (bodyEnd < bodyStart) return out;

  for (const col of table.columns) {
    if (col.dataType !== 'numeric' && col.dataType !== 'currency' && col.dataType !== 'percentage') {
      continue;
    }
    const bodyCells = table.cells.filter(
      (c) =>
        c.colIndex === col.colIndex &&
        c.rowIndex >= bodyStart &&
        c.rowIndex <= bodyEnd &&
        c.colSpan === 1,
    );
    const numericish = bodyCells.filter((c) => /^-?[\d,.]+%?$/.test(c.text.trim()));
    if (numericish.length < Math.ceil(bodyCells.length * 0.5) || numericish.length === 0) continue;

    // Excel 1-based rows; sheet row = table rowIndex + 1
    const colLetter = colToLetter(col.colIndex);
    const startRow = bodyStart + 1;
    const endRow = bodyEnd + 1;
    const formula = `SUM(${colLetter}${startRow}:${colLetter}${endRow})`;
    out.set(`${last.rowIndex},${col.colIndex}`, formula);
  }
  return out;
}

export function colToLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
