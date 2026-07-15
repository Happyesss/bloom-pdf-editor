import type { ExportResult } from '../../common/interfaces.js';
import type { UnifiedDocumentModel } from '../../udm/types.js';
import {
  escXml,
  extractContentBlocks,
  sanitizeFilename,
  tableToRows,
} from '../content.js';
import { createZip } from '../zip.js';

export class OdtExporter {
  readonly name = 'OdtExporter' as const;

  async export(udm: UnifiedDocumentModel): Promise<ExportResult> {
    const blocks = extractContentBlocks(udm);
    const contentBody = blocks.map(blockToOdt).join('\n');

    const files: Record<string, string> = {
      mimetype: 'application/vnd.oasis.opendocument.text',
      'META-INF/manifest.xml': `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
  <manifest:file-entry manifest:full-path="/" manifest:version="1.2" manifest:media-type="application/vnd.oasis.opendocument.text"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>
</manifest:manifest>`,
      'meta.xml': `<?xml version="1.0" encoding="UTF-8"?>
<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.2">
  <office:meta>
    <dc:title>${escXml(udm.metadata.title ?? '')}</dc:title>
    <dc:creator>${escXml(udm.metadata.author ?? 'Bloom')}</dc:creator>
  </office:meta>
</office:document-meta>`,
      'styles.xml': `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"
  xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" office:version="1.2">
  <office:styles>
    <style:style style:name="Standard" style:family="paragraph"/>
    <style:style style:name="Heading_20_1" style:display-name="Heading 1" style:family="paragraph">
      <style:text-properties fo:font-size="18pt" fo:font-weight="bold"/>
    </style:style>
  </office:styles>
</office:document-styles>`,
      'content.xml': `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"
  xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"
  xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0"
  xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" office:version="1.2">
  <office:body>
    <office:text>
${contentBody}
    </office:text>
  </office:body>
</office:document-content>`,
    };

    const bytes = createZip(files, {
      storeOnly: ['mimetype'],
      order: ['mimetype', 'META-INF/manifest.xml', 'content.xml', 'styles.xml', 'meta.xml'],
    });

    return {
      bytes,
      mimeType: 'application/vnd.oasis.opendocument.text',
      filename: `${sanitizeFilename(udm.metadata.title ?? 'document', 'document')}.odt`,
    };
  }
}

function blockToOdt(b: ReturnType<typeof extractContentBlocks>[number]): string {
  switch (b.kind) {
    case 'heading':
      return `      <text:h text:outline-level="${b.level}">${escXml(b.text)}</text:h>`;
    case 'paragraph':
    case 'caption':
      return `      <text:p>${escXml(b.text)}</text:p>`;
    case 'quote':
      return `      <text:p><text:span text:style-name="Emphasis">${escXml(b.text)}</text:span></text:p>`;
    case 'code':
      return `      <text:p>${escXml(b.text)}</text:p>`;
    case 'list': {
      const tag = b.ordered ? 'text:list' : 'text:list';
      return `      <${tag}>${b.items.map((i) => `<text:list-item><text:p>${escXml(i)}</text:p></text:list-item>`).join('')}</${tag}>`;
    }
    case 'table': {
      const rows = tableToRows(b.table)
        .map(
          (r) =>
            `<table:table-row>${r.map((c) => `<table:table-cell office:value-type="string"><text:p>${escXml(c)}</text:p></table:table-cell>`).join('')}</table:table-row>`,
        )
        .join('');
      return `      <table:table table:name="Table">${rows}</table:table>`;
    }
    case 'image':
      return `      <text:p>[Image: ${escXml(b.alt)}]</text:p>`;
    case 'link':
      return `      <text:p><text:a xlink:href="${escXml(b.uri)}" xmlns:xlink="http://www.w3.org/1999/xlink">${escXml(b.text)}</text:a></text:p>`;
  }
}
