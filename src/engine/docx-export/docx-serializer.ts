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
  TextRun as DocxTextRun,
  WidthType,
  ImageRun,
  Tab,
  TableLayoutType,
  type FileChild,
  type IBorderOptions,
} from 'docx';
import type { ExtractedDocument, ExtractedPage, Block, TextRun, TableBlock, ImageBlock } from './types';
import { ptTwips } from './glyph-extraction';

function alignOf(align?: 'left' | 'center' | 'right' | 'justify') {
  if (align === 'center') return AlignmentType.CENTER;
  if (align === 'right') return AlignmentType.RIGHT;
  if (align === 'justify') return AlignmentType.JUSTIFIED;
  return AlignmentType.LEFT;
}

const NONE_BORDER: IBorderOptions = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };

function lineBorder(color: string, size = 12): IBorderOptions {
  return { style: BorderStyle.SINGLE, size, color };
}

function toDocxRuns(runs: TextRun[]): DocxTextRun[] {
  return runs.map(
    run =>
      new DocxTextRun({
        text: run.text,
        bold: run.bold,
        italics: run.italic,
        color: run.color,
        size: Math.max(16, Math.round(run.fontSize * 2)), // half-points
        font: run.fontFamily,
      }),
  );
}

function tableToDocx(table: TableBlock, contentWidthTwips: number): Table {
  const raw = table.columnWidths.map(ptTwips);
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  const widths = raw.map(w => Math.max(200, Math.round((w / sum) * contentWidthTwips)));

  const borderColor = table.borderColor ?? '1B4D3E';
  const headerFill = table.headerFill ?? 'E6F2EA';
  const headerColor = table.headerColor ?? '1B4D3E';

  const rows = [];
  // For v1, we assume cells are flattened row by row
  // We need to group cells by row
  const rowCells: Record<number, typeof table.cells> = {};
  for (const cell of table.cells) {
    if (!rowCells[cell.row]) rowCells[cell.row] = [];
    rowCells[cell.row].push(cell);
  }

  for (let ri = 0; ri < table.rows; ri++) {
    const isHeader = ri === 0;
    const cells = rowCells[ri] || [];
    
    rows.push(new TableRow({
      children: cells.map((cell, ci) => {
        const runs = cell.runs.map(s =>
          isHeader && s.color === '000000' ? { ...s, bold: true, color: headerColor } : s
        );

        return new TableCell({
          width: { size: widths[cell.col] || widths[ci] || 1000, type: WidthType.DXA },
          shading: isHeader ? { type: ShadingType.CLEAR, fill: headerFill, color: 'auto' } : undefined,
          borders: {
            top: isHeader ? lineBorder(borderColor, 12) : NONE_BORDER,
            bottom: lineBorder(isHeader ? borderColor : 'CCCCCC', isHeader ? 8 : 4),
            left: NONE_BORDER,
            right: NONE_BORDER,
          },
          children: [
            new Paragraph({
              spacing: { before: 40, after: 40 },
              children: runs.length ? toDocxRuns(runs) : [new DocxTextRun({ text: '' })],
            }),
          ],
        });
      }),
    }));
  }

  return new Table({
    layout: TableLayoutType.FIXED,
    width: { size: contentWidthTwips, type: WidthType.DXA },
    columnWidths: widths,
    borders: {
      top: NONE_BORDER,
      bottom: NONE_BORDER,
      left: NONE_BORDER,
      right: NONE_BORDER,
      insideHorizontal: NONE_BORDER,
      insideVertical: NONE_BORDER,
    },
    rows,
  });
}

function blockToChildren(block: Block, contentWidthTwips: number): FileChild[] {
  if (block.type === 'table') {
    return [tableToDocx(block, contentWidthTwips), new Paragraph({ children: [] })];
  }

  if (block.type === 'heading') {
    const blocks: FileChild[] = [
      new Paragraph({
        alignment: alignOf(block.align),
        spacing: { before: 200, after: 80 },
        children: toDocxRuns(block.runs),
      })
    ];

    if (block.accentBorder) {
      blocks.push(new Table({
        layout: TableLayoutType.FIXED,
        width: { size: contentWidthTwips, type: WidthType.DXA },
        columnWidths: [contentWidthTwips],
        borders: {
          top: lineBorder(block.accentBorder, 12),
          bottom: NONE_BORDER, left: NONE_BORDER, right: NONE_BORDER, insideHorizontal: NONE_BORDER, insideVertical: NONE_BORDER,
        },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: contentWidthTwips, type: WidthType.DXA },
                borders: { top: NONE_BORDER, bottom: NONE_BORDER, left: NONE_BORDER, right: NONE_BORDER },
                children: [
                  new Paragraph({ children: [new DocxTextRun({ text: '\u00A0'.repeat(150), size: 2 })] })
                ]
              })
            ]
          })
        ]
      }));
    }
    return blocks;
  }

  if (block.type === 'list') {
    return [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing: { before: 40, after: 40 },
        indent: { left: 360, hanging: 180 },
        children: [new DocxTextRun({ text: block.marker === 'bullet' ? '• ' : '1. ' }), ...toDocxRuns(block.runs)],
      }),
    ];
  }

  if (block.type === 'hrule') {
    return []; // Handled entirely via HeadingBlock accentBorder now
  }

  if (block.type === 'split') {
    return [
      new Paragraph({
        alignment: AlignmentType.LEFT,
        tabStops: [{ type: TabStopType.RIGHT, position: contentWidthTwips }],
        spacing: { before: 120, after: 40 },
        children: [
          ...toDocxRuns(block.leftRuns),
          new DocxTextRun({ children: [new Tab()] }),
          ...toDocxRuns(block.rightRuns),
        ],
      }),
    ];
  }
  
  if (block.type === 'image') {
    return [
      new Paragraph({
        children: [
          new ImageRun({
            data: block.imageData,
            transformation: {
              width: block.width,
              height: block.height
            },
            type: 'png'
          })
        ]
      })
    ];
  }

  return [
    new Paragraph({
      alignment: alignOf(block.align),
      spacing: { before: 40, after: 40 },
      children: toDocxRuns(block.runs),
    }),
  ];
}

export async function serializeToDocx(doc: ExtractedDocument): Promise<Blob> {
  const sections = doc.pages.map(page => {
    const margin = 720;
    const contentWidth = Math.max(1000, ptTwips(page.width) - margin * 2);
    const children: FileChild[] = [];
    for (const block of page.blocks) {
      children.push(...blockToChildren(block, contentWidth));
    }
    return {
      properties: {
        page: {
          size: { width: ptTwips(page.width), height: ptTwips(page.height) },
          margin: { top: margin, right: margin, bottom: margin, left: margin },
        },
      },
      children,
    };
  });

  const document = new Document({
    creator: 'PDF Editor',
    title: doc.title || 'Export',
    sections,
  });

  return Packer.toBlob(document);
}
