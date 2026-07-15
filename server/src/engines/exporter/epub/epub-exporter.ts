import type { ExportResult } from '../../common/interfaces.js';
import type { UnifiedDocumentModel } from '../../udm/types.js';
import {
  escHtml,
  extractContentBlocks,
  sanitizeFilename,
  tableToRows,
} from '../content.js';
import { createZip } from '../zip.js';

export class EpubExporter {
  readonly name = 'EpubExporter' as const;

  async export(udm: UnifiedDocumentModel): Promise<ExportResult> {
    const blocks = extractContentBlocks(udm);
    const chapters = splitChapters(blocks);
    const title = udm.metadata.title ?? 'Document';
    const author = udm.metadata.author ?? 'Bloom';

    const files: Record<string, string> = {
      mimetype: 'application/epub+zip',
      'META-INF/container.xml': `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`,
    };

    const manifestItems: string[] = [
      '<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>',
      '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>',
      '<item id="css" href="style.css" media-type="text/css"/>',
    ];
    const spine: string[] = [];
    const navLis: string[] = [];
    const ncxNav: string[] = [];

    chapters.forEach((ch, i) => {
      const id = `chap${i + 1}`;
      const href = `chapter${i + 1}.xhtml`;
      files[`OEBPS/${href}`] = chapterXhtml(ch.title, ch.html);
      manifestItems.push(
        `<item id="${id}" href="${href}" media-type="application/xhtml+xml"/>`,
      );
      spine.push(`<itemref idref="${id}"/>`);
      navLis.push(`<li><a href="${href}">${escHtml(ch.title)}</a></li>`);
      ncxNav.push(
        `<navPoint id="navPoint-${i + 1}" playOrder="${i + 1}"><navLabel><text>${escHtml(ch.title)}</text></navLabel><content src="${href}"/></navPoint>`,
      );
    });

    files['OEBPS/style.css'] =
      'body{font-family:serif;line-height:1.5;margin:1em}h1,h2{margin:1em 0 .5em}table{border-collapse:collapse}td,th{border:1px solid #999;padding:.3em}';

    files['OEBPS/nav.xhtml'] = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>Contents</title><link rel="stylesheet" href="style.css"/></head>
<body>
<nav epub:type="toc"><h1>Contents</h1><ol>${navLis.join('')}</ol></nav>
</body></html>`;

    files['OEBPS/toc.ncx'] = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head><meta name="dtb:uid" content="${escHtml(udm.id)}"/></head>
  <docTitle><text>${escHtml(title)}</text></docTitle>
  <navMap>${ncxNav.join('')}</navMap>
</ncx>`;

    files['OEBPS/content.opf'] = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="uid" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">${escHtml(udm.id)}</dc:identifier>
    <dc:title>${escHtml(title)}</dc:title>
    <dc:creator>${escHtml(author)}</dc:creator>
    <dc:language>${escHtml(udm.metadata.language ?? 'en')}</dc:language>
    <meta property="dcterms:modified">${udm.metadata.createdAt.slice(0, 19)}Z</meta>
  </metadata>
  <manifest>${manifestItems.join('\n')}</manifest>
  <spine toc="ncx">${spine.join('\n')}</spine>
</package>`;

    const bytes = createZip(files, {
      storeOnly: ['mimetype'],
      order: ['mimetype', 'META-INF/container.xml', ...Object.keys(files).filter((k) => k.startsWith('OEBPS/'))],
    });

    return {
      bytes,
      mimeType: 'application/epub+zip',
      filename: `${sanitizeFilename(title, 'document')}.epub`,
    };
  }
}

function splitChapters(
  blocks: ReturnType<typeof extractContentBlocks>,
): Array<{ title: string; html: string }> {
  const chapters: Array<{ title: string; html: string[] }> = [];
  let current = { title: 'Chapter 1', html: [] as string[] };

  for (const b of blocks) {
    if (b.kind === 'heading' && b.level <= 2 && current.html.length > 0) {
      chapters.push(current);
      current = { title: b.text, html: [`<h${b.level}>${escHtml(b.text)}</h${b.level}>`] };
      continue;
    }
    if (b.kind === 'heading' && b.level <= 2 && current.html.length === 0) {
      current.title = b.text;
    }
    current.html.push(blockHtml(b));
  }
  chapters.push(current);
  return chapters.map((c) => ({ title: c.title, html: c.html.join('\n') }));
}

function blockHtml(b: ReturnType<typeof extractContentBlocks>[number]): string {
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
      return `<p><em>${escHtml(b.text)}</em></p>`;
    case 'list': {
      const tag = b.ordered ? 'ol' : 'ul';
      return `<${tag}>${b.items.map((i) => `<li>${escHtml(i)}</li>`).join('')}</${tag}>`;
    }
    case 'table': {
      const rows = tableToRows(b.table);
      return `<table>${rows.map((r) => `<tr>${r.map((c) => `<td>${escHtml(c)}</td>`).join('')}</tr>`).join('')}</table>`;
    }
    case 'image':
      return `<p><em>[Image: ${escHtml(b.alt)}]</em></p>`;
    case 'link':
      return `<p><a href="${escHtml(b.uri)}">${escHtml(b.text)}</a></p>`;
  }
}

function chapterXhtml(title: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head><title>${escHtml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
${body}
</body>
</html>`;
}
