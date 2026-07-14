import * as Engine from '../index';
import type { ExtractedPageData } from './glyph-extraction';
import type { ExportLine } from './grouping';
import type { Block, HeadingBlock, ListBlock, ParagraphBlock, TableBlock, SplitBlock, HRuleBlock, TextRun } from './types';
import { rgbToHex, mapPdfFontToWord } from './glyph-extraction';
import { sanitizeText } from './grouping';

function isNearBlack(hex: string): boolean {
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return r < 40 && g < 40 && b < 40;
}

function isAccentColor(hex: string): boolean {
  if (isNearBlack(hex) || hex === 'FFFFFF') return false;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return Math.max(r, g, b) - Math.min(r, g, b) > 25 || g > r + 15;
}

function lineAlign(line: ExportLine, pageWidth: number): 'left' | 'center' | 'right' {
  const mid = line.x + line.width / 2;
  const pageMid = pageWidth / 2;
  if (Math.abs(mid - pageMid) < pageWidth * 0.08 && line.x > pageWidth * 0.2) return 'center';
  if (line.x > pageWidth * 0.55) return 'right';
  return 'left';
}

function isBulletLine(text: string): boolean {
  return (
    /^[\u2022\u2023\u25E6\u2043\u2219\u00B7\u25CF\u25CB•∙\-–—]\s+/.test(text.trim()) ||
    /^\uF0B7\s*/.test(text)
  );
}

function stripBullet(text: string): string {
  return text.replace(/^[\u2022\u2023\u25E6\u2043\u2219\u00B7\u25CF\u25CB•∙\-–—\uF0B7]\s*/, '');
}

function isHeadingLine(line: ExportLine, pageWidth: number): boolean {
  const text = line.runs.map(s => s.text).join('').trim();
  if (!text || text.length > 80) return false;
  const avgSize = line.runs.reduce((s, x) => s + x.fontSize, 0) / Math.max(1, line.runs.length);
  const allBold = line.runs.length > 0 && line.runs.every(s => s.bold);
  const accent = line.runs.some(s => isAccentColor(s.color));
  const caps = text === text.toUpperCase() && /[A-Z]/.test(text);
  const shortCentered = lineAlign(line, pageWidth) === 'center' && avgSize >= 14;
  return (allBold && (caps || accent) && avgSize >= 11) || shortCentered || (caps && allBold);
}

function spanFromRawRun(run: Engine.TextRun, fonts: Map<string, Engine.FontData>): TextRun | null {
  const text = sanitizeText(run.text);
  if (!text) return null;
  const fontData = fonts.get(run.fontName) ?? null;
  const flags = Engine.resolveRunStyleFlags(run.fontName, fontData);
  return {
    text,
    fontFamily: mapPdfFontToWord(run.fontName, fontData),
    fontSize: run.fontSize || run.glyphs[0]?.fontSize || 11,
    bold: flags.bold,
    italic: flags.italic,
    color: rgbToHex(run.fillColor),
  };
}

function detectTitleDateSplit(
  line: ExportLine,
  fonts: Map<string, Engine.FontData>,
  pageWidth: number,
): { left: TextRun[]; right: TextRun[] } | null {
  const raw = line.rawLine;
  if (raw.runs.length < 2) return null;
  let bestIdx = -1;
  let bestGap = 0;
  for (let i = 0; i < raw.runs.length - 1; i++) {
    const a = raw.runs[i];
    const b = raw.runs[i + 1];
    const gap = b.x - (a.x + a.width);
    const styleChange = a.fontName !== b.fontName || a.fontSize !== b.fontSize;
    
    // Check if the right side text looks like a date (e.g. 2025, or Nov, Apr)
    const rightText = raw.runs.slice(i + 1).map(r => r.text).join(' ');
    const hasDate = /(20\d\d|19\d\d|Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i.test(rightText);
    
    // We aggressively split if there's a style change AND it looks like a date!
    if (gap > bestGap || (styleChange && hasDate)) {
      bestGap = Math.max(gap, 100); // Artificial boost if style changes
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || bestGap < 5) return null;
  
  const fullText = raw.runs.map(r => r.text).join('');
  if (fullText.includes('@') || fullText.includes('|')) return null;

  const left = raw.runs
    .slice(0, bestIdx + 1)
    .map(r => spanFromRawRun(r, fonts))
    .filter((s): s is TextRun => s !== null);
  const right = raw.runs
    .slice(bestIdx + 1)
    .map(r => spanFromRawRun(r, fonts))
    .filter((s): s is TextRun => s !== null);
  if (!left.length || !right.length) return null;
  return { left, right };
}

function findHorizontalRules(paths: Engine.PathItem[], pageWidth: number): Array<{ y: number; color: string; minX: number; maxX: number }> {
  const rules: Array<{ y: number; color: string; minX: number; maxX: number }> = [];
  for (const p of paths) {
    if (p.width < 50) continue;
    if (p.height > 10) continue;
    const color = rgbToHex(p.strokeColor ?? p.fillColor);
    rules.push({ y: p.y + p.height / 2, color: color === '000000' ? '1B4D3E' : color, minX: p.x, maxX: p.x + p.width });
  }
  rules.sort((a, b) => b.y - a.y);
  return rules;
}

function findTableHeaderFill(
  paths: Engine.PathItem[],
  tableY: number,
  tableHeight: number,
  tableX: number,
  tableWidth: number,
): string | undefined {
  let best: { area: number; color: string } | null = null;
  const topBand = tableY + tableHeight * 0.7;
  for (const p of paths) {
    if (p.paintType !== 'fill' && p.paintType !== 'both') continue;
    if (!p.fillColor) continue;
    if (p.height < 6 || p.height > 48) continue;
    if (p.width < tableWidth * 0.45) continue;
    const cy = p.y + p.height / 2;
    if (cy < tableY || cy > topBand) continue;
    if (p.x + p.width < tableX || p.x > tableX + tableWidth) continue;
    const color = rgbToHex(p.fillColor);
    if (isNearBlack(color) || color === 'FFFFFF') continue;
    const area = p.width * p.height;
    if (!best || area > best.area) best = { area, color };
  }
  return best?.color;
}

export function detectStructure(data: ExtractedPageData, lines: ExportLine[]): Block[] {
  const paths = data.displayList.filter((i): i is Engine.PathItem => i.type === 'path');
  const rules = findHorizontalRules(paths, data.pageWidth);
  const blocks: Block[] = [];
  
  const detectedTables = Engine.detectTablesOnPage(lines.map(l => l.rawLine), paths);
  const tableLineIds = new Set(detectedTables.flatMap(t => t.cells.map(c => c.line.id)));
  
  for (const t of detectedTables) {
    const widths: number[] = [];
    for (let c = 0; c < t.cols; c++) {
      const next = c + 1 < t.columnXs.length ? t.columnXs[c + 1] : t.bounds.x + t.bounds.width;
      widths.push(Math.max(40, next - t.columnXs[c]));
    }
    const headerFill = findTableHeaderFill(
      paths,
      t.bounds.y,
      t.bounds.height,
      t.bounds.x,
      t.bounds.width,
    );
    const headerCell = t.cells.find(c => c.row === 0);
    const headerColor = headerCell ? rgbToHex(headerCell.line.runs[0]?.fillColor) : undefined;
    
    const tableBlock: TableBlock = {
      type: 'table',
      x: t.bounds.x,
      y: t.bounds.y,
      width: t.bounds.width,
      height: t.bounds.height,
      rows: t.rows,
      cols: t.cols,
      columnWidths: widths,
      headerFill: headerFill ?? 'E6F2EA',
      headerColor: headerColor && isAccentColor(headerColor) ? headerColor : '1B4D3E',
      borderColor: '1B4D3E',
      cells: t.cells.map(cell => {
        const found = lines.find(l => l.id === cell.line.id);
        return {
          row: cell.row,
          col: cell.col,
          runs: found ? found.runs : [],
          isHeader: cell.row === 0
        };
      })
    };
    blocks.push(tableBlock);
  }

  const rows: ExportLine[][] = [];
  const nonTableLines = lines.filter(l => !tableLineIds.has(l.id));
  
  for (const line of nonTableLines) {
    if (rows.length === 0) {
      rows.push([line]);
      continue;
    }
    const lastRow = rows[rows.length - 1];
    if (Math.abs(line.baseline - lastRow[0].baseline) < 4) {
      lastRow.push(line);
    } else {
      rows.push([line]);
    }
  }

  for (const row of rows) {
    row.sort((a, b) => a.x - b.x);

    if (row.length === 2) {
      const left = row[0];
      const right = row[1];
      const gap = right.x - (left.x + left.width);
      if (gap > 20 && right.x > data.pageWidth * 0.45) {
        const splitBlock: SplitBlock = {
          type: 'split',
          x: left.x,
          y: left.y,
          width: (right.x + right.width) - left.x,
          height: Math.max(left.height, right.height),
          leftRuns: left.runs,
          rightRuns: right.runs,
        };
        blocks.push(splitBlock);
        continue;
      }
    }

    for (const line of row) {
      const text = line.runs.map(s => s.text).join('');
      
      const split = detectTitleDateSplit(line, data.fonts, data.pageWidth);
      if (split) {
        const splitBlock: SplitBlock = {
          type: 'split',
          x: line.x,
          y: line.y,
          width: line.width,
          height: line.height,
          leftRuns: split.left,
          rightRuns: split.right,
        };
        blocks.push(splitBlock);
        continue;
      }

      if (isBulletLine(text)) {
        const cleaned = line.runs
          .map((s, i) => (i === 0 ? { ...s, text: stripBullet(s.text) } : s))
          .filter(s => s.text.length > 0);
          
        const listBlock: ListBlock = {
          type: 'list',
          marker: 'bullet',
          x: line.x,
          y: line.y,
          width: line.width,
          height: line.height,
          runs: cleaned.length ? cleaned : line.runs,
        };
        blocks.push(listBlock);
        continue;
      }

      if (isHeadingLine(line, data.pageWidth)) {
        const text = line.runs.map(s => s.text).join('').trim();
        const caps = text === text.toUpperCase() && /[A-Z]/.test(text);
        const headingBlock: HeadingBlock = {
          type: 'heading',
          level: 1, 
          x: line.x,
          y: line.y,
          width: line.width,
          height: line.height,
          runs: line.runs,
          align: lineAlign(line, data.pageWidth),
          accentBorder: caps ? '1B4D3E' : undefined,
        };
        blocks.push(headingBlock);
        continue;
      }

      const paraBlock: ParagraphBlock = {
        type: 'paragraph',
        x: line.x,
        y: line.y,
        width: line.width,
        height: line.height,
        runs: line.runs,
        align: lineAlign(line, data.pageWidth),
      };
      blocks.push(paraBlock);
    }
  }

  blocks.sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > 4) return dy;
    return a.x - b.x;
  });

  return blocks;
}
