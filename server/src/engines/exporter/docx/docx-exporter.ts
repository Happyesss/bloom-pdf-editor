import type { ExportResult } from '../../common/interfaces.js';
import type { UnifiedDocumentModel } from '../../udm/types.js';
import { createZip } from '../zip.js';
import { writeDocument } from './document-writer.js';
import { buildNumberingXml } from './numbering.js';
import { buildStylesXml } from './styles.js';

/**
 * Phase 11 — DOCX Export Engine.
 * Consumes ONLY UnifiedDocumentModel. Never touches PDF/parser.
 */
export class DocxExporter {
  readonly name = 'DocxExporter' as const;

  async export(udm: UnifiedDocumentModel): Promise<ExportResult> {
    const written = writeDocument(udm);
    const files: Record<string, string | Uint8Array> = {};

    files['[Content_Types].xml'] = contentTypes(written);
    files['_rels/.rels'] = packageRels();
    files['docProps/core.xml'] = coreProps(udm);
    files['docProps/app.xml'] = appProps(udm);
    files['word/document.xml'] = written.documentXml;
    files['word/styles.xml'] = buildStylesXml();
    files['word/numbering.xml'] = buildNumberingXml();
    files['word/settings.xml'] = settingsXml();
    files['word/fontTable.xml'] = fontTableXml();
    files['word/webSettings.xml'] = webSettingsXml();

    const docRels: string[] = [
      rel(
        'rId1',
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles',
        'styles.xml',
      ),
      rel(
        'rId2',
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering',
        'numbering.xml',
      ),
      rel(
        'rId3',
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings',
        'settings.xml',
      ),
      rel(
        'rId4',
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/fontTable',
        'fontTable.xml',
      ),
      rel(
        'rId5',
        'http://schemas.openxmlformats.org/officeDocument/2006/relationships/webSettings',
        'webSettings.xml',
      ),
    ];

    if (written.headerXml) {
      files['word/header1.xml'] = written.headerXml;
      docRels.push(
        rel(
          'rIdHeader',
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header',
          'header1.xml',
        ),
      );
    }
    if (written.footerXml) {
      files['word/footer1.xml'] = written.footerXml;
      docRels.push(
        rel(
          'rIdFooter',
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer',
          'footer1.xml',
        ),
      );
    }
    if (written.footnotesXml) {
      files['word/footnotes.xml'] = written.footnotesXml;
      docRels.push(
        rel(
          'rIdFootnotes',
          'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes',
          'footnotes.xml',
        ),
      );
    }

    for (const r of written.rels) {
      docRels.push(rel(r.id, r.type, r.target, r.targetMode));
    }

    for (const m of written.media) {
      files[`word/media/${m.name}`] = m.data;
    }

    files['word/_rels/document.xml.rels'] = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${docRels.join('\n')}
</Relationships>`;

    const bytes = createZip(files);
    const filename = `${sanitize(udm.metadata.title ?? 'document')}.docx`;
    return {
      bytes,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename,
    };
  }
}

function contentTypes(written: ReturnType<typeof writeDocument>): string {
  const overrides: string[] = [
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>',
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>',
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>',
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>',
    '<Override PartName="/word/fontTable.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.fontTable+xml"/>',
    '<Override PartName="/word/webSettings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.webSettings+xml"/>',
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>',
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>',
  ];
  if (written.headerXml) {
    overrides.push(
      '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>',
    );
  }
  if (written.footerXml) {
    overrides.push(
      '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>',
    );
  }
  if (written.footnotesXml) {
    overrides.push(
      '<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>',
    );
  }
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="jpeg" ContentType="image/jpeg"/>
  <Default Extension="jpg" ContentType="image/jpeg"/>
  ${overrides.join('\n  ')}
</Types>`;
}

function packageRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function coreProps(udm: UnifiedDocumentModel): string {
  const title = escXml(udm.metadata.title ?? 'Document');
  const author = escXml(udm.metadata.author ?? 'Bloom');
  const created = udm.metadata.createdAt;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:dcmitype="http://purl.org/dc/dcmitype/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${title}</dc:title>
  <dc:creator>${author}</dc:creator>
  <cp:lastModifiedBy>${author}</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>
</cp:coreProperties>`;
}

function appProps(udm: UnifiedDocumentModel): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"
  xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Bloom Document Intelligence Engine</Application>
  <Pages>${udm.metadata.pageCount}</Pages>
</Properties>`;
}

function settingsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:zoom w:percent="100"/>
  <w:defaultTabStop w:val="720"/>
</w:settings>`;
}

function fontTableXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:font w:name="Calibri"><w:family w:val="swiss"/></w:font>
  <w:font w:name="Consolas"><w:family w:val="modern"/></w:font>
</w:fonts>`;
}

function webSettingsXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:webSettings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`;
}

function rel(id: string, type: string, target: string, targetMode?: string): string {
  const mode = targetMode ? ` TargetMode="${targetMode}"` : '';
  return `<Relationship Id="${id}" Type="${type}" Target="${escXml(target)}"${mode}/>`;
}

function escXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function sanitize(name: string): string {
  return name.replace(/[^\w\-]+/g, '_').slice(0, 64) || 'document';
}
