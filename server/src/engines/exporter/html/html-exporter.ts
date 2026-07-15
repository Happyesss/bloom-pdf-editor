import type { ExportResult } from '../../common/interfaces.js';
import type { UnifiedDocumentModel } from '../../udm/types.js';
import {
  escHtml,
  extractContentBlocks,
  sanitizeFilename,
  tableToRows,
} from '../content.js';

export class HtmlExporter {
  readonly name = 'HtmlExporter' as const;

  async export(udm: UnifiedDocumentModel): Promise<ExportResult> {
    const blocks = extractContentBlocks(udm);
    const body = blocks.map(blockToHtml).join('\n');
    const title = escHtml(udm.metadata.title ?? 'Document');
    const html = `<!DOCTYPE html>
<html lang="${escHtml(udm.metadata.language ?? 'en')}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>${title}</title>
<style>
body{font-family:system-ui,Segoe UI,sans-serif;line-height:1.5;max-width:48rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
h1,h2,h3,h4,h5,h6{line-height:1.2;margin:1.4em 0 .5em}
p{margin:.75em 0}blockquote{border-left:3px solid #ccc;margin:1em 0;padding:.25em 1em;color:#444}
pre,code{font-family:ui-monospace,Consolas,monospace;font-size:.9em}
pre{background:#f4f4f4;padding:1rem;overflow:auto}
table{border-collapse:collapse;width:100%;margin:1em 0}
th,td{border:1px solid #ccc;padding:.4em .6em;text-align:left}
th{background:#f0f0f0}img{max-width:100%;height:auto}
.caption{font-style:italic;color:#555;font-size:.9em}
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
    return {
      bytes: new TextEncoder().encode(html),
      mimeType: 'text/html; charset=utf-8',
      filename: `${sanitizeFilename(udm.metadata.title ?? 'document', 'document')}.html`,
    };
  }
}

function blockToHtml(b: ReturnType<typeof extractContentBlocks>[number]): string {
  switch (b.kind) {
    case 'heading':
      return `<h${b.level}>${escHtml(b.text)}</h${b.level}>`;
    case 'paragraph':
      return `<p>${escHtml(b.text)}</p>`;
    case 'quote':
      return `<blockquote><p>${escHtml(b.text)}</p></blockquote>`;
    case 'code':
      return `<pre><code>${escHtml(b.text)}</code></pre>`;
    case 'caption':
      return `<p class="caption">${escHtml(b.text)}</p>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      return `<${tag}>${b.items.map((i) => `<li>${escHtml(i)}</li>`).join('')}</${tag}>`;
    }
    case 'table': {
      const rows = tableToRows(b.table);
      if (!rows.length) return '';
      const [head, ...rest] = rows;
      const thead = head
        ? `<thead><tr>${head.map((c) => `<th>${escHtml(c)}</th>`).join('')}</tr></thead>`
        : '';
      const tbody = `<tbody>${rest.map((r) => `<tr>${r.map((c) => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;
      return `<table>${thead}${tbody}</table>`;
    }
    case 'image':
      return `<p><em>[Image: ${escHtml(b.alt)}]</em></p>`;
    case 'link':
      return `<p><a href="${escHtml(b.uri)}">${escHtml(b.text)}</a></p>`;
  }
}
