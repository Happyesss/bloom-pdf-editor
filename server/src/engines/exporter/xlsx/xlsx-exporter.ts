import type { ExportResult } from '../../common/interfaces.js';
import type { UnifiedDocumentModel } from '../../udm/types.js';
import { createZip } from '../zip.js';
import { SharedStringTable } from './shared-strings.js';
import { buildStylesXml } from './styles.js';
import { buildWorkbookRels, buildWorkbookXml } from './workbook.js';
import {
  buildEmptySheetXml,
  buildWorksheetXml,
  sheetNameFor,
} from './worksheet.js';

/**
 * Phase 12 — XLSX Export Engine.
 * Consumes ONLY UnifiedDocumentModel. Logical tables → worksheets.
 * Never dumps paragraphs as cells. Never touches PDF/parser.
 */
export class XlsxExporter {
  readonly name = 'XlsxExporter' as const;

  async export(udm: UnifiedDocumentModel): Promise<ExportResult> {
    const sst = new SharedStringTable();
    const files: Record<string, string | Uint8Array> = {};
    const sheetNames: string[] = [];

    if (udm.tables.length === 0) {
      sheetNames.push('Sheet1');
      files['xl/worksheets/sheet1.xml'] = buildEmptySheetXml(
        sst,
        'No logical tables detected in document.',
      );
    } else {
      const usedNames = new Set<string>();
      udm.tables.forEach((table, i) => {
        let name = sheetNameFor(table, i);
        let n = 1;
        while (usedNames.has(name.toLowerCase())) {
          name = `${sheetNameFor(table, i).slice(0, 25)}_${n++}`;
        }
        usedNames.add(name.toLowerCase());
        sheetNames.push(name);
        files[`xl/worksheets/sheet${i + 1}.xml`] = buildWorksheetXml(table, sst);
      });
    }

    files['[Content_Types].xml'] = contentTypes(sheetNames.length);
    files['_rels/.rels'] = packageRels();
    files['docProps/core.xml'] = coreProps(udm);
    files['docProps/app.xml'] = appProps(udm);
    files['xl/workbook.xml'] = buildWorkbookXml(sheetNames);
    files['xl/_rels/workbook.xml.rels'] = buildWorkbookRels(sheetNames.length);
    files['xl/styles.xml'] = buildStylesXml();
    files['xl/sharedStrings.xml'] = sst.toXml();

    const bytes = createZip(files);
    return {
      bytes,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${sanitize(udm.metadata.title ?? 'workbook')}.xlsx`,
    };
  }
}

function contentTypes(sheetCount: number): string {
  const sheets = Array.from(
    { length: sheetCount },
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${sheets}
</Types>`;
}

function packageRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function coreProps(udm: UnifiedDocumentModel): string {
  const title = esc(udm.metadata.title ?? 'Workbook');
  const author = esc(udm.metadata.author ?? 'Bloom');
  const created = udm.metadata.createdAt;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"
  xmlns:dc="http://purl.org/dc/elements/1.1/"
  xmlns:dcterms="http://purl.org/dc/terms/"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${title}</dc:title>
  <dc:creator>${author}</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>
</cp:coreProperties>`;
}

function appProps(udm: UnifiedDocumentModel): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Bloom Document Intelligence Engine</Application>
  <Pages>${udm.metadata.pageCount}</Pages>
</Properties>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function sanitize(name: string): string {
  return name.replace(/[^\w\-]+/g, '_').slice(0, 64) || 'workbook';
}
