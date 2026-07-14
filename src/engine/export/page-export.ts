/**
 * Semantic page export — Markdown serializer.
 *
 * Builds a logical page model from flow-like line input, then emits
 * GitHub-flavored Markdown.
 */

import type {
  ExportOptions,
  ExportPageInput,
  SemanticBlock,
  SemanticPage,
  SemanticSpan,
} from './types';
import { DEFAULT_EXPORT_OPTIONS } from './types';

// ─── Semantic page builder ────────────────────────────────────────────────────

let blockIdCounter = 0;

function inferBlockKind(line: ExportPageInput['lines'][0], prevY: number | null): SemanticBlock['kind'] {
  const fs = line.fontSize;
  if (fs >= 18) return 'heading';
  if (/^[\u2022\u25CF\-\*]\s/.test(line.text) || /^\d+\.\s/.test(line.text)) return 'list-item';
  if (prevY !== null && Math.abs(line.y - prevY) > line.height * 2.5) return 'paragraph';
  return 'paragraph';
}

function headingLevel(fontSize: number): number {
  if (fontSize >= 24) return 1;
  if (fontSize >= 20) return 2;
  if (fontSize >= 16) return 3;
  return 4;
}

/**
 * Construct a semantic page from extracted lines (sorted by reading order).
 * Tables (when provided) become native table blocks.
 */
export function buildSemanticPage(input: ExportPageInput): SemanticPage {
  const blocks: SemanticBlock[] = [];

  for (const line of input.lines) {
    const kind = inferBlockKind(line, null);
    const spans: SemanticSpan[] = [{
      text: line.text,
      bold: line.bold,
      italic: line.italic,
      fontSize: line.fontSize,
    }];

    blocks.push({
      id: `blk_${++blockIdCounter}`,
      kind,
      level: kind === 'heading' ? headingLevel(line.fontSize) : undefined,
      spans,
      text: line.text,
      x: line.x,
      y: line.y,
      width: line.width,
      height: line.height,
      listMarker: kind === 'list-item' ? line.text.match(/^([\u2022\u25CF\-\*]|\d+\.)/)?.[1] : undefined,
    });
  }

  for (const table of input.tables ?? []) {
    const cells = table.cells.map(c => ({
      row: c.row,
      col: c.col,
      text: c.text,
      spans: [{
        text: c.text,
        bold: c.bold,
        italic: c.italic,
        fontSize: c.fontSize,
      }] as SemanticSpan[],
    }));

    blocks.push({
      id: `blk_${++blockIdCounter}`,
      kind: 'table',
      spans: [],
      text: table.cells.map(c => c.text).join(' '),
      x: table.x,
      y: table.y,
      width: table.width,
      height: table.height,
      table: {
        rows: table.rows,
        cols: table.cols,
        cells,
        columnWidths: table.columnWidths,
      },
    });
  }

  // Reading order: top→bottom (PDF y-up), then left→right
  blocks.sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > Math.min(Math.max(a.height, 8), Math.max(b.height, 8)) * 0.5) return dy;
    return a.x - b.x;
  });

  // Refine heading/paragraph kinds with previous-Y context after sort
  let prevY: number | null = null;
  for (const block of blocks) {
    if (block.kind === 'table') {
      prevY = block.y;
      continue;
    }
    const lineLike = {
      text: block.text,
      x: block.x,
      y: block.y,
      width: block.width,
      height: block.height,
      fontSize: block.spans[0]?.fontSize ?? 12,
      bold: block.spans[0]?.bold,
      italic: block.spans[0]?.italic,
    };
    const kind = inferBlockKind(lineLike, prevY);
    block.kind = kind;
    block.level = kind === 'heading' ? headingLevel(lineLike.fontSize) : undefined;
    prevY = block.y;
  }

  return {
    pageIndex: input.pageIndex,
    width: input.width,
    height: input.height,
    title: input.title,
    blocks,
    readingOrder: blocks.map(b => b.id),
  };
}

// ─── Markdown export ─────────────────────────────────────────────────────────

function blockToMarkdown(block: SemanticBlock, opts: ExportOptions): string {
  if (block.kind === 'table' && block.table) {
    const { rows, cols, cells } = block.table;
    const grid: string[][] = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ''),
    );
    for (const cell of cells) {
      if (cell.row >= 0 && cell.row < rows && cell.col >= 0 && cell.col < cols) {
        grid[cell.row][cell.col] = cell.text.replace(/\|/g, '\\|').trim();
      }
    }
    if (rows === 0 || cols === 0) return block.text.trim();
    const header = `| ${grid[0].join(' | ')} |`;
    const sep = `| ${grid[0].map(() => '---').join(' | ')} |`;
    const body = grid.slice(1).map(r => `| ${r.join(' | ')} |`).join('\n');
    return body ? `${header}\n${sep}\n${body}` : `${header}\n${sep}`;
  }

  const text = block.text.trim();
  switch (block.kind) {
    case 'heading': {
      const lvl = Math.min(6, Math.max(1, block.level ?? 2));
      if (opts.markdownHeadingStyle === 'setext' && lvl <= 2) {
        const underline = lvl === 1 ? '=' : '-';
        return `${text}\n${underline.repeat(Math.max(text.length, 3))}`;
      }
      return `${'#'.repeat(lvl)} ${text}`;
    }
    case 'list-item':
      return `- ${text.replace(/^([\u2022\u25CF\-\*]|\d+\.)\s*/, '')}`;
    case 'blockquote':
      return text.split('\n').map(l => `> ${l}`).join('\n');
    case 'code':
      return '```\n' + text + '\n```';
    default:
      return text;
  }
}

/** Export semantic page to Markdown text. */
export function exportPageToMarkdown(
  page: SemanticPage,
  options: Partial<ExportOptions> = {},
): string {
  const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options };
  const ordered = page.readingOrder
    .map(id => page.blocks.find(b => b.id === id))
    .filter(Boolean) as SemanticBlock[];

  const parts: string[] = [];
  if (page.title) parts.push(`# ${page.title}`, '');

  for (const block of ordered) {
    parts.push(blockToMarkdown(block, opts));
    parts.push('');
  }

  return parts.join('\n').trimEnd() + '\n';
}

/** Convenience: build semantic page from line input and export Markdown. */
export function exportInputToMarkdown(
  input: ExportPageInput,
  options?: Partial<ExportOptions>,
): string {
  return exportPageToMarkdown(buildSemanticPage(input), options);
}

export function resetExportBlockIdCounter(): void {
  blockIdCounter = 0;
}
