import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildSemanticPage,
  exportPageToMarkdown,
  resetExportBlockIdCounter,
} from '../export/page-export';
import type { ExportPageInput } from '../export/types';

describe('export tables', () => {
  beforeEach(() => resetExportBlockIdCounter());

  const input: ExportPageInput = {
    pageIndex: 0,
    width: 612,
    height: 792,
    lines: [
      { text: 'EDUCATION & QUALIFICATIONS', x: 50, y: 700, width: 200, height: 14, fontSize: 14, bold: true },
      { text: 'PROFESSIONAL EXPERIENCE', x: 50, y: 400, width: 180, height: 14, fontSize: 14, bold: true },
    ],
    tables: [
      {
        rows: 3,
        cols: 4,
        x: 50,
        y: 520,
        width: 500,
        height: 80,
        columnWidths: [120, 80, 160, 140],
        cells: [
          { row: 0, col: 0, text: 'Course', fontSize: 10, bold: true },
          { row: 0, col: 1, text: 'Year', fontSize: 10, bold: true },
          { row: 0, col: 2, text: 'Institution/Board', fontSize: 10, bold: true },
          { row: 0, col: 3, text: 'Remarks', fontSize: 10, bold: true },
          { row: 1, col: 0, text: 'CA Final', fontSize: 10 },
          { row: 1, col: 1, text: 'May 2025', fontSize: 10 },
          { row: 1, col: 2, text: 'ICAI', fontSize: 10 },
          { row: 1, col: 3, text: 'Scored exemption in 3 subjects', fontSize: 10 },
          { row: 2, col: 0, text: 'CA Intermediate', fontSize: 10 },
          { row: 2, col: 1, text: 'Nov 2022', fontSize: 10 },
          { row: 2, col: 2, text: 'ICAI', fontSize: 10 },
          { row: 2, col: 3, text: 'AIR 41', fontSize: 10 },
        ],
      },
    ],
  };

  it('places a native table block between surrounding headings', () => {
    const page = buildSemanticPage(input);
    expect(page.blocks).toHaveLength(3);
    expect(page.blocks[0].text).toContain('EDUCATION');
    expect(page.blocks[1].kind).toBe('table');
    expect(page.blocks[1].table?.rows).toBe(3);
    expect(page.blocks[1].table?.cols).toBe(4);
    expect(page.blocks[2].text).toContain('PROFESSIONAL');
  });

  it('emits a markdown pipe table', () => {
    const page = buildSemanticPage(input);
    const md = exportPageToMarkdown(page);
    expect(md).toContain('| Course | Year | Institution/Board | Remarks |');
    expect(md).toContain('| CA Final | May 2025 | ICAI |');
  });
});
