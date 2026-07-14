/**
 * Serialize ExtractedDocument (from docx-export structure pipeline) to HTML / Markdown.
 *
 * HTML modes mirror iLovePDF:
 *   - exact: absolute-positioned text + images (layout preserved)
 *   - flow: semantic tags (headings, lists, tables) in reading order
 *
 * Markdown: GFM-style headings, lists, tables, images (data URLs).
 */

import type {
  Block,
  ExtractedDocument,
  ExtractedPage,
  HeadingBlock,
  ImageBlock,
  ListBlock,
  ParagraphBlock,
  SplitBlock,
  TableBlock,
  TextRun,
} from '../docx-export/types';

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function runsToHtml(runs: TextRun[]): string {
  return runs
    .map(run => {
      let t = escapeHtml(run.text);
      if (run.bold) t = `<strong>${t}</strong>`;
      if (run.italic) t = `<em>${t}</em>`;
      const size = Math.max(8, run.fontSize || 12);
      const color = run.color && run.color !== '#000000' ? `color:${run.color};` : '';
      return `<span style="font-size:${size}px;${color}">${t}</span>`;
    })
    .join('');
}

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

function tableToHtml(block: TableBlock): string {
  const { rows, cols, cells } = block;
  const grid: (typeof cells[0] | null)[][] = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => null),
  );
  for (const cell of cells) {
    if (cell.row >= 0 && cell.row < rows && cell.col >= 0 && cell.col < cols) {
      grid[cell.row][cell.col] = cell;
    }
  }
  const body = grid
    .map((row, ri) => {
      const tds = row
        .map(cell => {
          const content = cell ? runsToHtml(cell.runs) : '';
          const tag = cell?.isHeader || ri === 0 ? 'th' : 'td';
          return `<${tag}>${content}</${tag}>`;
        })
        .join('');
      return `<tr>${tds}</tr>`;
    })
    .join('\n');
  return `<table>${body}</table>`;
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

function blockToFlowHtml(block: Block): string {
  switch (block.type) {
    case 'heading': {
      const h = block as HeadingBlock;
      const lvl = Math.min(6, Math.max(1, h.level));
      return `<h${lvl}>${runsToHtml(h.runs)}</h${lvl}>`;
    }
    case 'paragraph': {
      const p = block as ParagraphBlock;
      return `<p>${runsToHtml(p.runs)}</p>`;
    }
    case 'list': {
      const l = block as ListBlock;
      const text = runsToPlain(l.runs).replace(/^([\u2022\u25CF\-\*]|\d+\.)\s*/, '');
      return `<li>${escapeHtml(text)}</li>`;
    }
    case 'table':
      return tableToHtml(block as TableBlock);
    case 'image': {
      const img = block as ImageBlock;
      const src = bytesToDataUrl(img.imageData, img.mimeType || 'image/png');
      return `<img src="${src}" alt="" style="max-width:100%;height:auto;" />`;
    }
    case 'split': {
      const s = block as SplitBlock;
      return `<div class="split"><div>${runsToHtml(s.leftRuns)}</div><div>${runsToHtml(s.rightRuns)}</div></div>`;
    }
    case 'hrule':
      return '<hr />';
    default:
      return '';
  }
}

function blockToExactHtml(block: Block, pageHeight: number): string {
  const top = pageHeight - block.y - block.height;
  const style = `position:absolute;left:${block.x.toFixed(1)}px;top:${top.toFixed(1)}px;width:${Math.max(4, block.width).toFixed(1)}px;`;

  switch (block.type) {
    case 'heading':
    case 'paragraph':
    case 'list': {
      const runs =
        block.type === 'heading'
          ? (block as HeadingBlock).runs
          : block.type === 'list'
            ? (block as ListBlock).runs
            : (block as ParagraphBlock).runs;
      const fs = runs[0]?.fontSize ?? 12;
      return `<div class="pdf-block" style="${style}font-size:${fs}px;line-height:1.2;white-space:pre-wrap;">${runsToHtml(runs)}</div>`;
    }
    case 'image': {
      const img = block as ImageBlock;
      const src = bytesToDataUrl(img.imageData, img.mimeType || 'image/png');
      return `<img class="pdf-block" src="${src}" alt="" style="${style}height:${block.height.toFixed(1)}px;object-fit:contain;" />`;
    }
    case 'table':
      return `<div class="pdf-block" style="${style}">${tableToHtml(block as TableBlock)}</div>`;
    case 'hrule':
      return `<hr class="pdf-block" style="${style}border:none;border-top:2px solid ${(block as { accentBorder?: string }).accentBorder || '#333'};margin:0;" />`;
    case 'split': {
      const s = block as SplitBlock;
      return `<div class="pdf-block split" style="${style}display:flex;gap:1rem;"><div>${runsToHtml(s.leftRuns)}</div><div>${runsToHtml(s.rightRuns)}</div></div>`;
    }
    default:
      return '';
  }
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

function pageToFlowHtml(page: ExtractedPage): string {
  const parts: string[] = [];
  let inList = false;

  for (const block of page.blocks) {
    if (block.type === 'list') {
      if (!inList) {
        parts.push('<ul>');
        inList = true;
      }
      parts.push(blockToFlowHtml(block));
    } else {
      if (inList) {
        parts.push('</ul>');
        inList = false;
      }
      parts.push(blockToFlowHtml(block));
    }
  }
  if (inList) parts.push('</ul>');

  return `<section class="pdf-page" data-page="${page.pageIndex + 1}">\n${parts.join('\n')}\n</section>`;
}

function pageToExactHtml(page: ExtractedPage): string {
  const items = page.blocks.map(b => blockToExactHtml(b, page.height)).filter(Boolean);
  return `<section class="pdf-page pdf-exact" data-page="${page.pageIndex + 1}" style="position:relative;width:${page.width}px;height:${page.height}px;margin:0 auto 2rem;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.12);overflow:hidden;">
${items.join('\n')}
</section>`;
}

export function structureToHTML(
  doc: ExtractedDocument,
  mode: 'exact' | 'flow' = 'exact',
): string {
  const sections = doc.pages.map(p =>
    mode === 'exact' ? pageToExactHtml(p) : pageToFlowHtml(p),
  );

  const title = escapeHtml(doc.title || 'Export');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  * { box-sizing: border-box; }
  body { margin: 0; padding: 1.5rem; background: #f4f4f5; color: #18181b; font-family: system-ui, -apple-system, sans-serif; line-height: 1.5; }
  .pdf-page { max-width: 900px; margin: 0 auto 2rem; }
  .pdf-exact { max-width: none; }
  table { border-collapse: collapse; width: 100%; margin: 0.5rem 0; }
  th, td { border: 1px solid #d4d4d8; padding: 0.35rem 0.5rem; text-align: left; vertical-align: top; }
  th { background: #f4f4f5; }
  img { max-width: 100%; }
  .split { display: flex; gap: 1.5rem; }
  .split > div { flex: 1; }
  h1,h2,h3,h4,h5,h6 { margin: 0.75em 0 0.35em; }
  p { margin: 0.4em 0; }
  ul { margin: 0.4em 0; padding-left: 1.25rem; }
</style>
</head>
<body>
${sections.join('\n')}
</body>
</html>`;
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
