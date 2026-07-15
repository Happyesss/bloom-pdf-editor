import type { ExportResult } from '../../common/interfaces.js';
import type { UnifiedDocumentModel } from '../../udm/types.js';
import { createZip } from '../zip.js';
import {
  buildPresentationRels,
  buildPresentationXml,
  buildSlideLayoutRels,
  buildSlideLayoutXml,
  buildSlideMasterRels,
  buildSlideMasterXml,
  buildSlideRels,
  buildThemeXml,
} from './presentation.js';
import {
  buildSlideXml,
  collectAbsorbedNodeIds,
  pageIndices,
  slideSizeEmu,
} from './slide.js';

/**
 * Phase 13 — PPTX Export Engine.
 * Consumes ONLY UnifiedDocumentModel. One page → one editable slide.
 * Never rasterizes complete pages. Never touches PDF/parser.
 */
export class PptxExporter {
  readonly name = 'PptxExporter' as const;

  async export(udm: UnifiedDocumentModel): Promise<ExportResult> {
    const pages = pageIndices(udm);
    const size = slideSizeEmu(udm);
    const absorbed = collectAbsorbedNodeIds(udm);
    const files: Record<string, string | Uint8Array> = {};

    pages.forEach((pageIndex, i) => {
      const n = i + 1;
      files[`ppt/slides/slide${n}.xml`] = buildSlideXml(udm, pageIndex, absorbed);
      files[`ppt/slides/_rels/slide${n}.xml.rels`] = buildSlideRels();
    });

    files['[Content_Types].xml'] = contentTypes(pages.length);
    files['_rels/.rels'] = packageRels();
    files['docProps/core.xml'] = coreProps(udm);
    files['docProps/app.xml'] = appProps(udm, pages.length);
    files['ppt/presentation.xml'] = buildPresentationXml(pages.length, size.cx, size.cy);
    files['ppt/_rels/presentation.xml.rels'] = buildPresentationRels(pages.length);
    files['ppt/slideLayouts/slideLayout1.xml'] = buildSlideLayoutXml();
    files['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = buildSlideLayoutRels();
    files['ppt/slideMasters/slideMaster1.xml'] = buildSlideMasterXml();
    files['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = buildSlideMasterRels();
    files['ppt/theme/theme1.xml'] = buildThemeXml();

    const bytes = createZip(files);
    return {
      bytes,
      mimeType:
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      filename: `${sanitize(udm.metadata.title ?? 'presentation')}.pptx`,
    };
  }
}

function contentTypes(slideCount: number): string {
  const slides = Array.from(
    { length: slideCount },
    (_, i) =>
      `<Override PartName="/ppt/slides/slide${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join('\n  ');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  <Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>
  <Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>
  <Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  ${slides}
</Types>`;
}

function packageRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;
}

function coreProps(udm: UnifiedDocumentModel): string {
  const title = esc(udm.metadata.title ?? 'Presentation');
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

function appProps(udm: UnifiedDocumentModel, slides: number): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
  <Application>Bloom Document Intelligence Engine</Application>
  <Slides>${slides}</Slides>
  <Pages>${udm.metadata.pageCount}</Pages>
</Properties>`;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
}

function sanitize(name: string): string {
  return name.replace(/[^\w\-]+/g, '_').slice(0, 64) || 'presentation';
}
