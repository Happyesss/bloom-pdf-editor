import type { ExportResult } from '../../common/interfaces.js';
import type { UnifiedDocumentModel } from '../../udm/types.js';
import { createZip } from '../zip.js';
import { buildNumberingXml } from './ooxml/numbering.js';
import { buildStylesXml } from './ooxml/styles.js';
import {
  appProps,
  contentTypes,
  coreProps,
  fontTableXml,
  packageRels,
  rel,
  sanitizeFilename,
  settingsXml,
  webSettingsXml,
} from './package/parts.js';
import { writeDocument } from './writers/document-writer.js';

/**
 * Phase 11 — DOCX Export Engine.
 * Consumes ONLY UnifiedDocumentModel. Never touches PDF/parser.
 */
export class DocxExporter {
  readonly name = 'DocxExporter' as const;

  async export(udm: UnifiedDocumentModel): Promise<ExportResult> {
    const written = writeDocument(udm);
    const files: Record<string, string | Uint8Array> = {};

    // Collect font names from typography for dynamic font table
    const usedFonts: string[] = [];
    if (udm.typography?.statistics?.primaryFonts) {
      for (const f of udm.typography.statistics.primaryFonts) {
        if (f.font) usedFonts.push(f.font);
      }
    }
    if (udm.typography?.statistics?.secondaryFonts) {
      for (const f of udm.typography.statistics.secondaryFonts) {
        if (f.font) usedFonts.push(f.font);
      }
    }

    files['[Content_Types].xml'] = contentTypes(written);
    files['_rels/.rels'] = packageRels();
    files['docProps/core.xml'] = coreProps(udm);
    files['docProps/app.xml'] = appProps(udm);
    files['word/document.xml'] = written.documentXml;
    files['word/styles.xml'] = buildStylesXml(udm.typography);
    files['word/numbering.xml'] = buildNumberingXml();
    files['word/settings.xml'] = settingsXml();
    files['word/fontTable.xml'] = fontTableXml(usedFonts);
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
    const filename = `${sanitizeFilename(udm.metadata.title ?? 'document')}.docx`;
    return {
      bytes,
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      filename,
    };
  }
}
