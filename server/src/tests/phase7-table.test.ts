import { describe, it, expect } from 'vitest';
import { createContainer } from '../container.js';
import { LayoutEngine } from '../engines/layout/layout-engine.js';
import { IntermediateDocumentEngine } from '../engines/idm/idm-engine.js';
import { TypographyAnalyzer } from '../engines/typography/analyzer.js';
import { SemanticStructureEngine } from '../engines/semantic/engine.js';
import { TableDetectionEngine } from '../engines/table/engine.js';
import type { RawDocument } from '../engines/parser/raw-model.js';
import {
  borderlessGrid2x3Chars,
  headerGridChars,
  mergedTopLabelChars,
  rawBordered,
  rawFromChars,
  typedColumnChars,
} from './helpers/table-fixtures.js';

async function tablePipeline(raw: RawDocument) {
  const layout = await new LayoutEngine().analyze(raw);
  const idm = await new IntermediateDocumentEngine().build(raw, layout);
  const typography = await new TypographyAnalyzer().analyze(idm);
  const semantic = await new SemanticStructureEngine().generate({ idm, layout, typography });
  const engine = new TableDetectionEngine();
  const result = await engine.detect({ semantic, layout, raw, typography });
  return { raw, layout, idm, typography, semantic, result, engine };
}

describe('Phase 7 — Table Detection & Reconstruction', () => {
  it('detects a borderless 2×3 text grid', async () => {
    const { result } = await tablePipeline(rawFromChars(borderlessGrid2x3Chars()));
    expect(result.tables.length).toBeGreaterThanOrEqual(1);
    const t = result.tables[0]!;
    expect(t.rows.length).toBeGreaterThanOrEqual(2);
    expect(t.columns.length).toBeGreaterThanOrEqual(2);
    expect(t.cells.filter((c) => c.text.trim()).length).toBeGreaterThanOrEqual(4);
    expect(['borderless', 'mixed', 'bordered']).toContain(t.kind);

    const tables = Object.values(result.semantic.nodes).filter((n) => n.type === 'table');
    expect(tables.length).toBeGreaterThanOrEqual(1);
  });

  it('detects bordered grid from vector re lines', async () => {
    const { result } = await tablePipeline(rawBordered());
    expect(result.tables.length).toBeGreaterThanOrEqual(1);
    const t = result.tables[0]!;
    expect(t.kind === 'bordered' || t.kind === 'mixed').toBe(true);
    expect(t.rows.length).toBeGreaterThanOrEqual(2);
    expect(t.columns.length).toBeGreaterThanOrEqual(2);
    // Cell bounds snap to line positions
    const xs = new Set(t.cells.map((c) => Math.round(c.bbox.x)));
    expect(xs.size).toBeGreaterThanOrEqual(2);
  });

  it('marks bold/larger first row as header', async () => {
    const { result } = await tablePipeline(rawFromChars(headerGridChars()));
    expect(result.tables.length).toBeGreaterThanOrEqual(1);
    const t = result.tables[0]!;
    expect(t.rows[0]?.role).toBe('header');
    expect(t.quality.header).toBeGreaterThan(0.5);
  });

  it('detects merged cells with colSpan >= 2', async () => {
    const { result } = await tablePipeline(rawFromChars(mergedTopLabelChars()));
    expect(result.tables.length).toBeGreaterThanOrEqual(1);
    const t = result.tables[0]!;
    const merged = t.cells.filter((c) => c.colSpan >= 2 || c.rowSpan >= 2);
    expect(merged.length).toBeGreaterThanOrEqual(1);
  });

  it('types numeric/currency/percentage columns', async () => {
    const { result } = await tablePipeline(rawFromChars(typedColumnChars()));
    expect(result.tables.length).toBeGreaterThanOrEqual(1);
    const t = result.tables[0]!;
    const types = t.columns.map((c) => c.dataType);
    expect(types.some((d) => d === 'currency' || d === 'numeric')).toBe(true);
    expect(types.some((d) => d === 'percentage' || d === 'numeric')).toBe(true);
  });

  it('exposes DetectTables / BuildGrid / GenerateLogicalTable APIs', async () => {
    const raw = rawFromChars(borderlessGrid2x3Chars());
    const { semantic, layout, typography, engine } = await tablePipeline(raw);
    const input = { semantic, layout, raw, typography };
    const detected = engine.DetectTables(input);
    expect(detected.tables.length).toBeGreaterThanOrEqual(1);

    const candidates = (
      await import('../engines/table/algorithms/defaults.js')
    ).createDefaultTableStrategies().candidates.detect(input);
    expect(candidates.length).toBeGreaterThanOrEqual(1);
    const grid = engine.BuildGrid(candidates[0]!, input);
    expect(grid).not.toBeNull();
    if (grid) {
      const logical = engine.GenerateLogicalTable(candidates[0]!, grid, input);
      expect(logical).not.toBeNull();
      expect(logical!.cells.length).toBeGreaterThan(0);
    }
  });

  it('produces no DOCX/XLSX export artifacts', async () => {
    const { result } = await tablePipeline(rawFromChars(borderlessGrid2x3Chars()));
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/docx|xlsx|spreadsheetml|word\/document/i);
    expect(result.tables[0]).not.toHaveProperty('ooxml');
  });

  it('container exposes table engine via DI', () => {
    const container = createContainer({
      memoryStorage: true,
      configOverrides: { 'telemetry.enabled': false },
    });
    expect(container.table.name).toBe('TableDetectionEngine');
  });
});
