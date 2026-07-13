/**
 * Local PDF → DOCX export (no cloud APIs / tokens).
 *
 * Uses the `docx` library to emit valid Word files, and our PDF engine for
 * structure: tables, colors, fonts, bold/italic, bullets, h-rules, title/date.
 */

import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TabStopPosition,
  TabStopType,
  TextRun,
  WidthType,
  type FileChild,
  type IBorderOptions,
} from 'docx';
import type { PDFDocumentData, PathItem, TextRun as PdfTextRun, FontData, TextLine } from '@/engine';

export interface FlowDocxOptions {
  title: string;
  pages: number[] | null;
}

export interface FlowDocxResult {
  blob: Blob;
  filename: string;
  mimeType: string;
}

type Engine = typeof import('@/engine');

interface RichSpan {
  text: string;
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  color: string;
}

interface RichLine {
  kind: 'paragraph' | 'heading' | 'list' | 'hrule' | 'title-date';
  x: number;
  y: number;
  width: number;
  height: number;
  spans: RichSpan[];
  rightSpans?: RichSpan[];
  align?: 'left' | 'center' | 'right';
  accentBorder?: string;
}

interface RichTableCell {
  row: number;
  col: number;
  spans: RichSpan[];
}

interface RichTable {
  kind: 'table';
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
  cols: number;
  columnWidths: number[];
  cells: RichTableCell[];
  headerFill?: string;
  headerColor?: string;
  borderColor?: string;
}

type FlowBlock = RichLine | RichTable;

function ptTwips(pt: number): number {
  return Math.max(1, Math.round(pt * 20));
}

function rgbToHex(rgb: [number, number, number] | null | undefined): string {
  if (!rgb) return '000000';
  const h = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`.toUpperCase();
}

function stripSubset(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, '');
}

function styleFlags(fontName: string, fontData?: FontData | null): { bold: boolean; italic: boolean } {
  if (fontData?.standardMetrics) {
    return {
      bold: fontData.standardMetrics.isBold,
      italic: fontData.standardMetrics.isItalic,
    };
  }
  const lower = stripSubset(fontData?.baseFont || fontName).toLowerCase();
  return {
    bold: /bold|black|heavy|extrabold|demibold|semibold/.test(lower),
    italic: /italic|oblique|slanted/.test(lower),
  };
}

export function mapPdfFontToWord(fontName: string, fontData?: FontData | null): string {
  const base = stripSubset(fontData?.baseFont || fontName);
  const n = base.toLowerCase();
  if (n.includes('helvetica') || n.includes('arial')) return 'Arial';
  if (n.includes('times')) return 'Times New Roman';
  if (n.includes('courier')) return 'Courier New';
  if (n.includes('garamond')) return 'Garamond';
  if (n.includes('georgia')) return 'Georgia';
  if (n.includes('verdana')) return 'Verdana';
  if (n.includes('tahoma')) return 'Tahoma';
  if (n.includes('calibri')) return 'Calibri';
  if (n.includes('cambria')) return 'Cambria';
  if (n.includes('trebuchet')) return 'Trebuchet MS';
  const cleaned = base
    .replace(/[-_]?(Bold|Italic|Oblique|Regular|Medium|Light|Black|Heavy|SemiBold|DemiBold).*$/i, '')
    .replace(/MT$/i, '')
    .trim();
  return cleaned || 'Calibri';
}

function sanitizeText(text: string): string {
  return [...text]
    .map(ch => {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x09) return '';
      if (code === 0x09 || code === 0x0a || code === 0x0d) return ' ';
      if (code < 0x20) return '';
      if (code === 0xfffd || code === 0xfffc) return '';
      return ch;
    })
    .join('');
}

function spanFromRun(run: PdfTextRun, fonts: Map<string, FontData>): RichSpan | null {
  const text = sanitizeText(run.text);
  if (!text) return null;
  const fontData = fonts.get(run.fontName) ?? null;
  const flags = styleFlags(run.fontName, fontData);
  return {
    text,
    fontFamily: mapPdfFontToWord(run.fontName, fontData),
    fontSize: run.fontSize || run.glyphs[0]?.fontSize || 11,
    bold: flags.bold,
    italic: flags.italic,
    color: rgbToHex(run.fillColor),
  };
}

function spansFromLine(line: TextLine, fonts: Map<string, FontData>): RichSpan[] {
  const spans: RichSpan[] = [];
  for (const run of line.runs) {
    const s = spanFromRun(run, fonts);
    if (s) spans.push(s);
  }
  const merged: RichSpan[] = [];
  for (const s of spans) {
    const prev = merged[merged.length - 1];
    if (
      prev &&
      prev.fontFamily === s.fontFamily &&
      Math.abs(prev.fontSize - s.fontSize) < 0.5 &&
      prev.bold === s.bold &&
      prev.italic === s.italic &&
      prev.color === s.color
    ) {
      prev.text += s.text;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

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

function lineAlign(line: TextLine, pageWidth: number): 'left' | 'center' | 'right' {
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

function isHeadingLine(line: TextLine, spans: RichSpan[], pageWidth: number): boolean {
  const text = spans.map(s => s.text).join('').trim();
  if (!text || text.length > 80) return false;
  const avgSize = spans.reduce((s, x) => s + x.fontSize, 0) / Math.max(1, spans.length);
  const allBold = spans.length > 0 && spans.every(s => s.bold);
  const accent = spans.some(s => isAccentColor(s.color));
  const caps = text === text.toUpperCase() && /[A-Z]/.test(text);
  const shortCentered = lineAlign(line, pageWidth) === 'center' && avgSize >= 14;
  return (allBold && (caps || accent) && avgSize >= 11) || shortCentered || (caps && allBold);
}

function findHorizontalRules(paths: PathItem[], pageWidth: number): Array<{ y: number; color: string }> {
  const rules: Array<{ y: number; color: string }> = [];
  for (const p of paths) {
    if (p.paintType === 'none') continue;
    if (p.width < pageWidth * 0.35) continue;
    if (p.height > 5) continue;
    const color = rgbToHex(p.strokeColor ?? p.fillColor);
    rules.push({ y: p.y + p.height / 2, color: color === '000000' ? '1B4D3E' : color });
  }
  rules.sort((a, b) => b.y - a.y);
  return rules;
}

function findTableHeaderFill(
  paths: PathItem[],
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

function detectTitleDateSplit(
  line: TextLine,
  fonts: Map<string, FontData>,
  pageWidth: number,
): { left: RichSpan[]; right: RichSpan[] } | null {
  if (line.runs.length < 2) return null;
  let bestIdx = -1;
  let bestGap = 0;
  for (let i = 0; i < line.runs.length - 1; i++) {
    const a = line.runs[i];
    const b = line.runs[i + 1];
    const gap = b.x - (a.x + a.width);
    if (gap > bestGap) {
      bestGap = gap;
      bestIdx = i;
    }
  }
  if (bestIdx < 0 || bestGap < Math.max(line.fontSize * 4, 36)) return null;
  if (line.runs[bestIdx + 1].x < pageWidth * 0.45) return null;

  const left = line.runs
    .slice(0, bestIdx + 1)
    .map(r => spanFromRun(r, fonts))
    .filter(Boolean) as RichSpan[];
  const right = line.runs
    .slice(bestIdx + 1)
    .map(r => spanFromRun(r, fonts))
    .filter(Boolean) as RichSpan[];
  if (!left.length || !right.length) return null;
  return { left, right };
}

function buildPageBlocks(
  doc: PDFDocumentData,
  pageIndex: number,
  engine: Engine,
): { width: number; height: number; blocks: FlowBlock[] } {
  const page = doc.pages[pageIndex];
  const width = page.mediaBox.width;
  const height = page.mediaBox.height;

  const contentBytes = engine.getPageContentBytes(page, doc.objects);
  const interpreted = engine.interpretPage(contentBytes, page, doc.objects);
  const flow = engine.buildDocumentFlow(interpreted.textRuns);
  const fonts = engine.loadPageFonts(page.resources, doc.objects);
  const paths = interpreted.displayList.filter((i): i is PathItem => i.type === 'path');
  const rules = findHorizontalRules(paths, width);

  const detected = engine.detectTablesOnPage(flow.lines, paths);
  const tableLineIds = new Set(detected.flatMap(t => t.cells.map(c => c.line.id)));

  const blocks: FlowBlock[] = [];

  for (const t of detected) {
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

    blocks.push({
      kind: 'table',
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
      cells: t.cells.map(cell => ({
        row: cell.row,
        col: cell.col,
        spans: spansFromLine(cell.line, fonts),
      })),
    });
  }

  for (const line of flow.lines) {
    if (tableLineIds.has(line.id)) continue;
    const spans = spansFromLine(line, fonts);
    if (!spans.length) continue;

    const text = spans.map(s => s.text).join('');
    const split = detectTitleDateSplit(line, fonts, width);
    if (split) {
      blocks.push({
        kind: 'title-date',
        x: line.x,
        y: line.y,
        width: line.width,
        height: line.height,
        spans: split.left,
        rightSpans: split.right,
      });
      continue;
    }

    if (isBulletLine(text)) {
      const cleaned = spans
        .map((s, i) => (i === 0 ? { ...s, text: stripBullet(s.text) } : s))
        .filter(s => s.text.length > 0);
      blocks.push({
        kind: 'list',
        x: line.x,
        y: line.y,
        width: line.width,
        height: line.height,
        spans: cleaned.length ? cleaned : spans,
      });
      continue;
    }

    if (isHeadingLine(line, spans, width)) {
      const nearRule = rules.find(r => r.y < line.baseline && line.baseline - r.y < line.fontSize * 2.5);
      blocks.push({
        kind: 'heading',
        x: line.x,
        y: line.y,
        width: line.width,
        height: line.height,
        spans,
        align: lineAlign(line, width),
        accentBorder: nearRule?.color,
      });
      continue;
    }

    blocks.push({
      kind: 'paragraph',
      x: line.x,
      y: line.y,
      width: line.width,
      height: line.height,
      spans,
      align: lineAlign(line, width),
    });
  }

  for (const rule of rules) {
    const nearHeading = blocks.some(b => b.kind === 'heading' && Math.abs(b.y - rule.y) < 20);
    if (nearHeading) continue;
    blocks.push({
      kind: 'hrule',
      x: 0,
      y: rule.y,
      width,
      height: 2,
      spans: [],
      accentBorder: rule.color,
    });
  }

  blocks.sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > 4) return dy;
    return a.x - b.x;
  });

  return { width, height, blocks };
}

function toDocxRuns(spans: RichSpan[]): TextRun[] {
  return spans.map(
    span =>
      new TextRun({
        text: span.text,
        bold: span.bold,
        italics: span.italic,
        color: span.color,
        size: Math.max(16, Math.round(span.fontSize * 2)), // half-points
        font: span.fontFamily,
      }),
  );
}

function alignOf(align?: 'left' | 'center' | 'right') {
  if (align === 'center') return AlignmentType.CENTER;
  if (align === 'right') return AlignmentType.RIGHT;
  return AlignmentType.LEFT;
}

const NONE_BORDER: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

function lineBorder(color: string, size = 12): IBorderOptions {
  return { style: BorderStyle.SINGLE, size, color };
}

function blockToChildren(block: FlowBlock, contentWidthTwips: number): FileChild[] {
  if (block.kind === 'table') {
    return [tableToDocx(block, contentWidthTwips), new Paragraph({ children: [] })];
  }

  if (block.kind === 'hrule') {
    const color = block.accentBorder ?? '1B4D3E';
    return [
      new Paragraph({
        border: { bottom: lineBorder(color, 12) },
        spacing: { before: 60, after: 120 },
        children: [],
      }),
    ];
  }

  if (block.kind === 'title-date') {
    return [
      new Paragraph({
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        spacing: { before: 120, after: 40 },
        children: [
          ...toDocxRuns(block.spans),
          new TextRun({ text: '\t' }),
          ...toDocxRuns(block.rightSpans ?? []),
        ],
      }),
    ];
  }

  if (block.kind === 'heading') {
    return [
      new Paragraph({
        alignment: alignOf(block.align),
        spacing: { before: 200, after: 80 },
        border: block.accentBorder
          ? { bottom: lineBorder(block.accentBorder, 12) }
          : undefined,
        children: toDocxRuns(block.spans),
      }),
    ];
  }

  if (block.kind === 'list') {
    return [
      new Paragraph({
        spacing: { before: 40, after: 40 },
        indent: { left: 360, hanging: 180 },
        children: [new TextRun({ text: '• ' }), ...toDocxRuns(block.spans)],
      }),
    ];
  }

  return [
    new Paragraph({
      alignment: alignOf(block.align),
      spacing: { before: 40, after: 40 },
      children: toDocxRuns(block.spans),
    }),
  ];
}

function tableToDocx(table: RichTable, contentWidthTwips: number): Table {
  const raw = table.columnWidths.map(ptTwips);
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  const widths = raw.map(w => Math.max(200, Math.round((w / sum) * contentWidthTwips)));

  const grid: (RichTableCell | null)[][] = Array.from({ length: table.rows }, () =>
    Array.from({ length: table.cols }, () => null),
  );
  for (const cell of table.cells) {
    if (cell.row < table.rows && cell.col < table.cols) grid[cell.row][cell.col] = cell;
  }

  const borderColor = table.borderColor ?? '1B4D3E';
  const headerFill = table.headerFill ?? 'E6F2EA';
  const headerColor = table.headerColor ?? '1B4D3E';

  const rows = grid.map((row, ri) => {
    const isHeader = ri === 0;
    return new TableRow({
      children: row.map((cell, ci) => {
        const spans = (cell?.spans ?? []).map(s =>
          isHeader
            ? {
                ...s,
                bold: true,
                color: !isNearBlack(s.color) && isAccentColor(s.color) ? s.color : headerColor,
              }
            : s,
        );

        return new TableCell({
          width: { size: widths[ci], type: WidthType.DXA },
          shading: isHeader
            ? { type: ShadingType.CLEAR, fill: headerFill, color: 'auto' }
            : undefined,
          borders: {
            top: isHeader ? lineBorder(borderColor, 12) : NONE_BORDER,
            bottom: lineBorder(isHeader ? borderColor : 'CCCCCC', isHeader ? 8 : 4),
            left: NONE_BORDER,
            right: NONE_BORDER,
          },
          children: [
            new Paragraph({
              spacing: { before: 40, after: 40 },
              children: spans.length ? toDocxRuns(spans) : [new TextRun({ text: '' })],
            }),
          ],
        });
      }),
    });
  });

  return new Table({
    width: { size: contentWidthTwips, type: WidthType.DXA },
    columnWidths: widths,
    rows,
  });
}

async function buildDocxBlob(
  pages: Array<{ width: number; height: number; blocks: FlowBlock[] }>,
  title: string,
): Promise<Blob> {
  const sections = pages.map(page => {
    const margin = 720;
    const contentWidth = Math.max(1000, ptTwips(page.width) - margin * 2);
    const children: FileChild[] = [];
    for (const block of page.blocks) {
      children.push(...blockToChildren(block, contentWidth));
    }
    return {
      properties: {
        page: {
          size: {
            width: ptTwips(page.width),
            height: ptTwips(page.height),
          },
          margin: {
            top: margin,
            right: margin,
            bottom: margin,
            left: margin,
          },
        },
      },
      children,
    };
  });

  const document = new Document({
    creator: 'PDF Editor',
    title,
    sections,
  });

  return Packer.toBlob(document);
}

/**
 * Export PDF pages to DOCX entirely in-browser (no API keys).
 */
export async function exportFlowDocx(
  doc: PDFDocumentData,
  engine: Engine,
  options: FlowDocxOptions,
  onProgress?: (current: number, total: number) => void,
): Promise<FlowDocxResult> {
  const indexes = options.pages ?? Array.from({ length: doc.pages.length }, (_, i) => i);
  const pages = [];
  for (let i = 0; i < indexes.length; i++) {
    pages.push(buildPageBlocks(doc, indexes[i], engine));
    onProgress?.(i + 1, indexes.length);
  }

  const blob = await buildDocxBlob(pages, options.title);
  return {
    blob,
    filename: `${options.title}.docx`,
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  };
}
