/**
 * Serialize ExtractedDocument (from docx-export structure pipeline) to Markdown.
 *
 * Markdown: GFM-style headings, lists, tables, images (data URLs).
 */

import type {
  Block,
  ExtractedDocument,
  HeadingBlock,
  ImageBlock,
  ListBlock,
  ParagraphBlock,
  SplitBlock,
  TableBlock,
  TextRun,
} from '../docx-export/types';

function runsToPlain(runs: TextRun[]): string {
  return runs.map(r => r.text).join('');
}

function bytesToDataUrl(data: Uint8Array, mimeType: string): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function tableToMarkdown(block: TableBlock): string {
  const { rows, cols, cells } = block;
  if (rows === 0 || cols === 0) return '';
  const grid: string[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ''),
  );
  for (const cell of cells) {
    if (cell.row >= 0 && cell.row < rows && cell.col >= 0 && cell.col < cols) {
      grid[cell.row][cell.col] = runsToPlain(cell.runs).replace(/\|/g, '\\|').trim();
    }
  }
  const header = `| ${grid[0].join(' | ')} |`;
  const sep = `| ${grid[0].map(() => '---').join(' | ')} |`;
  const body = grid.slice(1).map(r => `| ${r.join(' | ')} |`).join('\n');
  return body ? `${header}\n${sep}\n${body}` : `${header}\n${sep}`;
}

function blockToMarkdown(block: Block): string {
  switch (block.type) {
    case 'heading': {
      const h = block as HeadingBlock;
      const lvl = Math.min(6, Math.max(1, h.level));
      return `${'#'.repeat(lvl)} ${runsToPlain(h.runs).trim()}`;
    }
    case 'paragraph':
      return runsToPlain((block as ParagraphBlock).runs).trim();
    case 'list': {
      const l = block as ListBlock;
      const text = runsToPlain(l.runs).replace(/^([\u2022\u25CF\-\*]|\d+\.)\s*/, '').trim();
      return l.marker === 'number' ? `1. ${text}` : `- ${text}`;
    }
    case 'table':
      return tableToMarkdown(block as TableBlock);
    case 'image': {
      const img = block as ImageBlock;
      const src = bytesToDataUrl(img.imageData, img.mimeType || 'image/png');
      return `![image](${src})`;
    }
    case 'split': {
      const s = block as SplitBlock;
      return `${runsToPlain(s.leftRuns).trim()} | ${runsToPlain(s.rightRuns).trim()}`;
    }
    case 'hrule':
      return '---';
    default:
      return '';
  }
}

export function structureToMarkdown(doc: ExtractedDocument): string {
  const parts: string[] = [];
  if (doc.title) {
    parts.push(`# ${doc.title}`, '');
  }

  for (const page of doc.pages) {
    if (doc.pages.length > 1) {
      parts.push(`## Page ${page.pageIndex + 1}`, '');
    }
    for (const block of page.blocks) {
      const md = blockToMarkdown(block);
      if (md.trim()) {
        parts.push(md, '');
      }
    }
  }

  return parts.join('\n').trimEnd() + '\n';
}
