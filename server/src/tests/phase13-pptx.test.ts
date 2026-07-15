import { describe, it, expect } from 'vitest';
import { LayoutEngine } from '../engines/layout/layout-engine.js';
import { IntermediateDocumentEngine } from '../engines/idm/idm-engine.js';
import { TypographyAnalyzer } from '../engines/typography/analyzer.js';
import { SemanticStructureEngine } from '../engines/semantic/engine.js';
import { TableDetectionEngine } from '../engines/table/engine.js';
import { GraphicsReconstructionEngine } from '../engines/graphics/engine.js';
import { DocumentStructureEngine } from '../engines/structure/engine.js';
import { assembleUnifiedDocument } from '../engines/udm/assemble.js';
import { PptxExporter } from '../engines/exporter/pptx/pptx-exporter.js';
import { ExportManager } from '../engines/exporter/export-manager.js';
import { readZipEntry } from '../engines/exporter/zip.js';
import {
  buildPage,
  buildRawDocument,
  wordChars,
  type CharSpec,
} from './helpers/raw-fixtures.js';
import { borderlessGrid2x3Chars } from './helpers/table-fixtures.js';

async function buildUdm(chars: CharSpec[]) {
  const raw = buildRawDocument([buildPage({ chars })]);
  const layout = await new LayoutEngine().analyze(raw);
  const idm = await new IntermediateDocumentEngine().build(raw, layout);
  const typography = await new TypographyAnalyzer().analyze(idm);
  const semantic = await new SemanticStructureEngine().generate({ idm, layout, typography });
  const tables = await new TableDetectionEngine().detect({ semantic, layout, raw, typography });
  const graphics = await new GraphicsReconstructionEngine().reconstruct({
    semantic: tables.semantic,
    layout,
    raw,
    tables,
  });
  const structure = await new DocumentStructureEngine().build({
    semantic: tables.semantic,
    tables: tables.tables,
    graphics: graphics.graphics,
    layout,
    raw,
    idm,
  });
  return assembleUnifiedDocument({
    idm,
    semantic: tables.semantic,
    tables: tables.tables,
    graphics: graphics.graphics,
    structure: structure.structure,
    typography,
  });
}

describe('Phase 13 — PPTX Export Engine', () => {
  it('exports presentation with editable text shapes on slide1', async () => {
    const chars: CharSpec[] = [
      ...wordChars('Overview', 72, 700, 18),
      ...wordChars('Body text for the slide export path', 72, 500, 12),
    ];
    for (const c of chars) {
      if (c.fontSize === 18) c.fontWeight = 700;
    }
    const udm = await buildUdm(chars);
    const result = await new PptxExporter().export(udm);
    expect(result.filename.endsWith('.pptx')).toBe(true);
    expect(result.mimeType).toContain('presentationml');
    expect(result.bytes[0]).toBe(0x50);

    expect(readZipEntry(result.bytes, 'ppt/presentation.xml')).toBeTruthy();
    const slide = readZipEntry(result.bytes, 'ppt/slides/slide1.xml');
    expect(slide).toBeTruthy();
    const xml = new TextDecoder().decode(slide!);
    expect(xml).toContain('<p:sp');
    expect(xml).toContain('<a:t>');
    // No full-page raster media
    expect(readZipEntry(result.bytes, 'ppt/media/slide1.png')).toBeNull();
  });

  it('emits native table graphic when logical tables exist', async () => {
    const udm = await buildUdm(borderlessGrid2x3Chars());
    const result = await new PptxExporter().export(udm);
    const slide = new TextDecoder().decode(readZipEntry(result.bytes, 'ppt/slides/slide1.xml')!);
    if (udm.tables.length > 0) {
      expect(slide).toContain('<a:tbl');
      expect(slide).toContain('<p:graphicFrame');
    } else {
      expect(slide).toContain('<p:sp');
    }
  });

  it('includes master, layout, and theme parts', async () => {
    const udm = await buildUdm([...wordChars('Slide', 72, 500, 12)]);
    const result = await new PptxExporter().export(udm);
    expect(readZipEntry(result.bytes, 'ppt/slideMasters/slideMaster1.xml')).toBeTruthy();
    expect(readZipEntry(result.bytes, 'ppt/slideLayouts/slideLayout1.xml')).toBeTruthy();
    expect(readZipEntry(result.bytes, 'ppt/theme/theme1.xml')).toBeTruthy();
  });

  it('ExportManager registers pptx', async () => {
    const manager = new ExportManager(true);
    expect(manager.supportedTargets()).toContain('pptx');
    const udm = await buildUdm([...wordChars('Hello', 72, 500, 12)]);
    const result = await manager.export(udm, 'pptx');
    expect(result.bytes.byteLength).toBeGreaterThan(500);
  });
});
