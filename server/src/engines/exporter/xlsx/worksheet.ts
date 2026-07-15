import type { ColumnDataType, LogicalTable } from '../../table/types.js';
import { colToLetter, inferSummaryFormulas } from './formulas.js';
import type { SharedStringTable } from './shared-strings.js';
import { STYLE } from './styles.js';

export function buildWorksheetXml(table: LogicalTable, sst: SharedStringTable): string {
  const formulas = inferSummaryFormulas(table);
  const rowCount = table.rows.length;
  const colCount = Math.max(table.columns.length, 1);
  const merges: string[] = [];
  const occupied = new Set<string>();
  const sheetRows: string[] = [];

  for (let r = 0; r < rowCount; r++) {
    const row = table.rows[r]!;
    const cellsXml: string[] = [];
    for (let c = 0; c < colCount; c++) {
      if (occupied.has(`${r},${c}`)) continue;
      const cell = table.cells.find((x) => x.rowIndex === r && x.colIndex === c);
      if (!cell) continue;

      if (cell.colSpan > 1 || cell.rowSpan > 1) {
        const endCol = colToLetter(c + cell.colSpan - 1);
        const endRow = r + cell.rowSpan;
        merges.push(`${colToLetter(c)}${r + 1}:${endCol}${endRow}`);
        for (let rr = 0; rr < cell.rowSpan; rr++) {
          for (let cc = 0; cc < cell.colSpan; cc++) {
            if (rr || cc) occupied.add(`${r + rr},${c + cc}`);
          }
        }
      }

      const ref = `${colToLetter(c)}${r + 1}`;
      const formula = formulas.get(`${r},${c}`);
      const isHeader = row.role === 'header';
      const dataType = table.columns[c]?.dataType ?? 'text';
      cellsXml.push(writeCell(ref, cell.text, dataType, isHeader, formula, sst));
    }
    const ht = row.height > 0 ? ` ht="${Math.max(15, row.height * 0.75)}" customHeight="1"` : '';
    sheetRows.push(`<row r="${r + 1}"${ht}>${cellsXml.join('')}</row>`);
  }

  const colsXml = table.columns
    .map((col, i) => {
      const width = Math.max(8, Math.min(60, (col.width || 80) / 7));
      return `<col min="${i + 1}" max="${i + 1}" width="${width.toFixed(2)}" customWidth="1"/>`;
    })
    .join('');

  const headerRows = table.rows.filter((r) => r.role === 'header').length;
  const freeze =
    headerRows > 0
      ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRows}" topLeftCell="A${headerRows + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>`
      : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;

  const mergeXml =
    merges.length > 0
      ? `<mergeCells count="${merges.length}">${merges.map((m) => `<mergeCell ref="${m}"/>`).join('')}</mergeCells>`
      : '';

  const dim = `A1:${colToLetter(colCount - 1)}${Math.max(rowCount, 1)}`;

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  ${freeze}
  <cols>${colsXml || '<col min="1" max="1" width="12" customWidth="1"/>'}</cols>
  <sheetData>${sheetRows.join('') || '<row r="1"><c r="A1" t="s"><v>0</v></c></row>'}</sheetData>
  ${mergeXml}
  <dimension ref="${dim}"/>
</worksheet>`;
}

export function buildEmptySheetXml(sst: SharedStringTable, note: string): string {
  const idx = sst.index(note);
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"/></sheetViews>
  <sheetData>
    <row r="1"><c r="A1" t="s" s="${STYLE.normal}"><v>${idx}</v></c></row>
  </sheetData>
</worksheet>`;
}

function writeCell(
  ref: string,
  text: string,
  dataType: ColumnDataType,
  isHeader: boolean,
  formula: string | undefined,
  sst: SharedStringTable,
): string {
  if (formula) {
    return `<c r="${ref}" s="${styleFor(dataType, isHeader)}"><f>${esc(formula)}</f></c>`;
  }

  if (isHeader || dataType === 'text') {
    const idx = sst.index(text || '');
    return `<c r="${ref}" t="s" s="${isHeader ? STYLE.header : STYLE.normal}"><v>${idx}</v></c>`;
  }

  const parsed = parseTyped(text, dataType);
  if (parsed == null) {
    const idx = sst.index(text || '');
    return `<c r="${ref}" t="s" s="${STYLE.normal}"><v>${idx}</v></c>`;
  }
  return `<c r="${ref}" s="${styleFor(dataType, false)}"><v>${parsed}</v></c>`;
}

function parseTyped(text: string, dataType: ColumnDataType): number | null {
  const t = text.trim();
  if (!t) return null;
  if (dataType === 'percentage') {
    const m = t.match(/^(-?[\d,.]+)\s*%$/);
    if (m) return Number(m[1]!.replace(/,/g, '')) / 100;
    const n = Number(t.replace(/,/g, ''));
    return Number.isFinite(n) ? (n > 1 ? n / 100 : n) : null;
  }
  if (dataType === 'currency') {
    const m = t.replace(/[$€£¥,\s]/g, '');
    const n = Number(m);
    return Number.isFinite(n) ? n : null;
  }
  if (dataType === 'numeric') {
    const n = Number(t.replace(/,/g, ''));
    return Number.isFinite(n) ? n : null;
  }
  if (dataType === 'date') {
    // Store as shared string — date serial conversion is best-effort skipped
    return null;
  }
  return null;
}

function styleFor(dataType: ColumnDataType, isHeader: boolean): number {
  if (isHeader) return STYLE.header;
  switch (dataType) {
    case 'currency':
      return STYLE.currency;
    case 'percentage':
      return STYLE.percent;
    case 'date':
      return STYLE.date;
    case 'numeric':
      return STYLE.numeric;
    default:
      return STYLE.normal;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function sheetNameFor(table: LogicalTable, index: number): string {
  const header = table.cells
    .filter((c) => c.rowIndex === 0)
    .sort((a, b) => a.colIndex - b.colIndex)[0]?.text;
  const base = (header?.trim() || `Table${index + 1}`).replace(/[\\/*?:\[\]]/g, '').slice(0, 28);
  return base || `Table${index + 1}`;
}
