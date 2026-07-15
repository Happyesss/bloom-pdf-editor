import { describe, it, expect } from 'vitest';
import { LayoutEngine } from '../engines/layout/layout-engine.js';
import { IntermediateDocumentEngine } from '../engines/idm/idm-engine.js';
import { TypographyAnalyzer } from '../engines/typography/analyzer.js';
import { SemanticStructureEngine } from '../engines/semantic/engine.js';
import { TableDetectionEngine } from '../engines/table/engine.js';
import { GraphicsReconstructionEngine } from '../engines/graphics/engine.js';
import { DocumentStructureEngine } from '../engines/structure/engine.js';
import { assembleUnifiedDocument } from '../engines/udm/assemble.js';
import { XlsxExporter } from '../engines/exporter/xlsx/xlsx-exporter.js';
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

describe('Phase 12 — XLSX Export Engine', () => {
  it('exports workbook + worksheet from logical tables', async () => {
    const udm = await buildUdm(borderlessGrid2x3Chars());
    const result = await new XlsxExporter().export(udm);
    expect(result.filename.endsWith('.xlsx')).toBe(true);
    expect(result.mimeType).toContain('spreadsheetml');
    expect(result.bytes[0]).toBe(0x50);
    expect(result.bytes[1]).toBe(0x4b);

    const workbook = readZipEntry(result.bytes, 'xl/workbook.xml');
    expect(workbook).toBeTruthy();
    const sheet = readZipEntry(result.bytes, 'xl/worksheets/sheet1.xml');
    expect(sheet).toBeTruthy();
    const xml = new TextDecoder().decode(sheet!);
    expect(xml).toContain('<c ');
    expect(readZipEntry(result.bytes, 'xl/sharedStrings.xml')).toBeTruthy();
    expect(readZipEntry(result.bytes, 'xl/styles.xml')).toBeTruthy();
  });

  it('emits Sheet1 note when no tables (never dumps paragraphs as cells)', async () => {
    const udm = await buildUdm([...wordChars('Just a paragraph', 72, 500, 12)]);
    udm.tables = [];
    const result = await new XlsxExporter().export(udm);
    const sheet = new TextDecoder().decode(readZipEntry(result.bytes, 'xl/worksheets/sheet1.xml')!);
    expect(sheet).toContain('<c ');
    const sst = new TextDecoder().decode(readZipEntry(result.bytes, 'xl/sharedStrings.xml')!);
    expect(sst).toMatch(/No logical tables/i);
  });

  it('ExportManager registers xlsx', async () => {
    const manager = new ExportManager(true);
    expect(manager.supportedTargets()).toContain('xlsx');
    const udm = await buildUdm(borderlessGrid2x3Chars());
    const result = await manager.export(udm, 'xlsx');
    expect(result.bytes.byteLength).toBeGreaterThan(200);
  });

  it('exporter modules do not reference parser/raw PDF types', async () => {
    const udm = await buildUdm(borderlessGrid2x3Chars());
    const json = JSON.stringify(await new XlsxExporter().export(udm));
    expect(json).not.toMatch(/objectGraph|spatialIndex|RawDocument/);
  });
});
