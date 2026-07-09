/**
 * Semantic page export — HTML and Markdown serializers.
 *
 * Builds a logical page model from flow-like line input, then emits
 * standards-friendly HTML or GitHub-flavored Markdown.
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
 */
export function buildSemanticPage(input: ExportPageInput): SemanticPage {
  const sorted = [...input.lines].sort((a, b) => {
    const dy = b.y - a.y;
    if (Math.abs(dy) > Math.min(a.height, b.height) * 0.5) return dy;
    return a.x - b.x;
  });

  const blocks: SemanticBlock[] = [];
  let prevY: number | null = null;

  for (const line of sorted) {
    const kind = inferBlockKind(line, prevY);
    const spans: SemanticSpan[] = [{
      text: line.text,
      bold: line.bold,
      italic: line.italic,
      fontSize: line.fontSize,
    }];

    const block: SemanticBlock = {
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
    };
    blocks.push(block);
    prevY = line.y;
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

// ─── HTML export ─────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function spanToHtml(span: SemanticSpan, opts: ExportOptions): string {
  let inner = opts.escapeHtml ? escapeHtml(span.text) : span.text;
  if (span.link) {
    inner = `<a href="${escapeHtml(span.link)}">${inner}</a>`;
  }
  const styles: string[] = [];
  if (opts.inlineStyles && span.fontSize) styles.push(`font-size:${span.fontSize}pt`);
  if (span.bold) inner = `<strong>${inner}</strong>`;
  if (span.italic) inner = `<em>${inner}</em>`;
  if (styles.length) return `<span style="${styles.join(';')}">${inner}</span>`;
  return inner;
}

function blockToHtml(block: SemanticBlock, opts: ExportOptions): string {
  const inner = block.spans.map(s => spanToHtml(s, opts)).join('');
  switch (block.kind) {
    case 'heading': {
      const lvl = Math.min(6, Math.max(1, block.level ?? 2));
      return `<h${lvl}>${inner}</h${lvl}>`;
    }
    case 'list-item':
      return `<li>${inner.replace(/^([\u2022\u25CF\-\*]|\d+\.)\s*/, '')}</li>`;
    case 'blockquote':
      return `<blockquote>${inner}</blockquote>`;
    case 'code':
      return `<pre><code>${inner}</code></pre>`;
    default:
      return `<p>${inner}</p>`;
  }
}

/**
 * Export semantic page to HTML fragment or full document.
 */
export function exportPageToHTML(
  page: SemanticPage,
  options: Partial<ExportOptions> = {},
): string {
  const opts = { ...DEFAULT_EXPORT_OPTIONS, ...options, title: page.title ?? options.title ?? DEFAULT_EXPORT_OPTIONS.title };

  const ordered = opts.documentWrapper
    ? page.readingOrder.map(id => page.blocks.find(b => b.id === id)).filter(Boolean) as SemanticBlock[]
    : page.blocks;

  const bodyParts: string[] = [];
  let inList = false;

  for (const block of ordered) {
    if (block.kind === 'list-item') {
      if (!inList) {
        bodyParts.push('<ul>');
        inList = true;
      }
      bodyParts.push(blockToHtml(block, opts));
    } else {
      if (inList) {
        bodyParts.push('</ul>');
        inList = false;
      }
      bodyParts.push(blockToHtml(block, opts));
    }
  }
  if (inList) bodyParts.push('</ul>');

  const body = bodyParts.join('\n');

  if (!opts.documentWrapper) return body;

  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '<meta charset="utf-8">',
    `<title>${escapeHtml(opts.title)}</title>`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<style>body{font-family:system-ui,sans-serif;max-width:${page.width}px;margin:1rem auto;line-height:1.5;}</style>`,
    '</head>',
    '<body>',
    body,
    '</body>',
    '</html>',
  ].join('\n');
}

// ─── Markdown export ─────────────────────────────────────────────────────────

function blockToMarkdown(block: SemanticBlock, opts: ExportOptions): string {
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

/** Convenience: build semantic page from line input and export HTML. */
export function exportInputToHTML(
  input: ExportPageInput,
  options?: Partial<ExportOptions>,
): string {
  return exportPageToHTML(buildSemanticPage(input), options);
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
