import { describe, it, expect } from 'vitest';
import { createContainer } from '../container.js';
import { LayoutEngine } from '../engines/layout/layout-engine.js';
import { IntermediateDocumentEngine } from '../engines/idm/idm-engine.js';
import { TypographyAnalyzer } from '../engines/typography/analyzer.js';
import { SemanticStructureEngine } from '../engines/semantic/engine.js';
import { TableDetectionEngine } from '../engines/table/engine.js';
import { GraphicsReconstructionEngine } from '../engines/graphics/engine.js';
import { PageSpatialIndex } from '../engines/parser/spatial-index.js';
import type { RawImage, RawVector } from '../engines/parser/raw-model.js';
import {
  buildPage,
  buildRawDocument,
  wordChars,
} from './helpers/raw-fixtures.js';

function makeImage(pageId: string, opts: {
  x: number;
  y: number;
  w: number;
  h: number;
  name?: string;
}): RawImage {
  return {
    id: `img_${opts.name ?? 'a'}`,
    type: 'image',
    parentId: pageId,
    childIds: [],
    pageIndex: 0,
    bbox: { x: opts.x, y: opts.y, width: opts.w, height: opts.h },
    transform: [1, 0, 0, 1, opts.x, opts.y],
    zIndex: 10,
    imageType: 'jpeg',
    widthPx: Math.round(opts.w),
    heightPx: Math.round(opts.h),
    dpi: 72,
    compression: 'DCTDecode',
    colorSpace: 'DeviceRGB',
    hasTransparency: false,
    rotation: 0,
    resourceName: opts.name ?? 'Im0',
  };
}

function makeRectVector(pageId: string, x: number, y: number, w: number, h: number, id: string): RawVector {
  return {
    id,
    type: 'vector',
    parentId: pageId,
    childIds: [],
    pageIndex: 0,
    bbox: { x, y, width: w, height: h },
    transform: [1, 0, 0, 1, 0, 0],
    zIndex: 5,
    pathCommands: [{ op: 're', x, y, w, h }],
    strokeWidth: 1,
    strokeColor: { space: 'DeviceGray', values: [0] },
    fillColor: { space: 'DeviceGray', values: [0.3] },
    dashPattern: [],
    joinStyle: 0,
    capStyle: 0,
    opacity: 1,
    paint: 'fillStroke',
  };
}

describe('Phase 8 — Graphics Reconstruction', () => {
  it('detects images without copying bytes', async () => {
    const page = buildPage({
      chars: wordChars('Caption below', 72, 300, 11),
      images: [{ x: 72, y: 360, w: 200, h: 120 }],
    });
    // Ensure no data payload
    for (const img of page.images) delete img.data;

    const raw = buildRawDocument([page]);
    const layout = await new LayoutEngine().analyze(raw);
    const idm = await new IntermediateDocumentEngine().build(raw, layout);
    const typography = await new TypographyAnalyzer().analyze(idm);
    const semantic = await new SemanticStructureEngine().generate({ idm, layout, typography });
    const tables = await new TableDetectionEngine().detect({ semantic, layout, raw, typography });
    const engine = new GraphicsReconstructionEngine();
    const result = await engine.reconstruct({
      semantic: tables.semantic,
      layout,
      raw,
      tables,
    });

    const images = result.graphics.objects.filter((o) => o.kind === 'image');
    expect(images.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(result)).not.toMatch(/"data":\s*\[/);
    expect(result.graphics.resources.images).toBeTruthy();
  });

  it('classifies rectangle vectors as editable shapes', async () => {
    const page = buildPage({ chars: wordChars('Body text here', 72, 200, 12) });
    const vec = makeRectVector(page.id, 100, 400, 80, 40, 'vec_rect');
    const spatial = page.spatialIndex as PageSpatialIndex;
    spatial.insert({ id: vec.id, type: 'vector', bbox: vec.bbox, zIndex: 5 });
    page.vectors = [vec];

    const raw = buildRawDocument([page]);
    const layout = await new LayoutEngine().analyze(raw);
    const idm = await new IntermediateDocumentEngine().build(raw, layout);
    const typography = await new TypographyAnalyzer().analyze(idm);
    const semantic = await new SemanticStructureEngine().generate({ idm, layout, typography });
    const engine = new GraphicsReconstructionEngine();
    const vectors = engine.DetectVectors({ semantic, layout, raw, tables: null });
    expect(vectors.some((v) => v.shape === 'rectangle')).toBe(true);
  });

  it('detects bar-chart candidates from aligned rectangles', async () => {
    const page = buildPage({ chars: wordChars('Sales', 72, 100, 12) });
    const bars = [
      makeRectVector(page.id, 80, 200, 30, 40, 'b1'),
      makeRectVector(page.id, 120, 200, 30, 70, 'b2'),
      makeRectVector(page.id, 160, 200, 30, 55, 'b3'),
      makeRectVector(page.id, 200, 200, 30, 90, 'b4'),
    ];
    const spatial = page.spatialIndex as PageSpatialIndex;
    for (const b of bars) {
      spatial.insert({ id: b.id, type: 'vector', bbox: b.bbox, zIndex: 5 });
    }
    page.vectors = bars;

    const raw = buildRawDocument([page]);
    const layout = await new LayoutEngine().analyze(raw);
    const idm = await new IntermediateDocumentEngine().build(raw, layout);
    const typography = await new TypographyAnalyzer().analyze(idm);
    const semantic = await new SemanticStructureEngine().generate({ idm, layout, typography });
    const engine = new GraphicsReconstructionEngine();
    const result = engine.GenerateGraphicsModel({ semantic, layout, raw });
    const charts = result.graphics.objects.filter((o) => o.kind === 'chart');
    expect(charts.some((c) => c.kind === 'chart' && c.chartKind === 'bar')).toBe(true);
    expect(charts.some((c) => c.kind === 'chart' && c.editableCandidate)).toBe(true);
  });

  it('groups nearby graphics and assigns wrap modes', async () => {
    const page = buildPage({
      chars: [
        ...wordChars('Left column text that wraps', 72, 400, 11),
        ...wordChars('more text beside figure', 72, 380, 11),
      ],
    });
    page.images = [
      makeImage(page.id, { x: 280, y: 360, w: 120, h: 80, name: 'fig' }),
    ];
    const spatial = page.spatialIndex as PageSpatialIndex;
    spatial.insert({
      id: page.images[0]!.id,
      type: 'image',
      bbox: page.images[0]!.bbox,
      zIndex: 10,
    });
    page.vectors = [
      makeRectVector(page.id, 290, 450, 40, 30, 'v1'),
      makeRectVector(page.id, 340, 455, 35, 25, 'v2'),
    ];
    for (const v of page.vectors) {
      spatial.insert({ id: v.id, type: 'vector', bbox: v.bbox, zIndex: 5 });
    }

    const raw = buildRawDocument([page]);
    const layout = await new LayoutEngine().analyze(raw);
    const idm = await new IntermediateDocumentEngine().build(raw, layout);
    const typography = await new TypographyAnalyzer().analyze(idm);
    const semantic = await new SemanticStructureEngine().generate({ idm, layout, typography });
    const engine = new GraphicsReconstructionEngine();
    const result = engine.GenerateGraphicsModel({ semantic, layout, raw });

    expect(result.graphics.objects.some((o) => o.kind === 'group')).toBe(true);
    expect(result.graphics.objects.every((o) => !!o.wrap)).toBe(true);
  });

  it('exposes DetectImages / DetectVectors / AnalyzeCharts / GenerateGraphicsModel', async () => {
    const page = buildPage({ chars: wordChars('Hi', 72, 400, 12), images: [{ x: 100, y: 500, w: 50, h: 50 }] });
    const raw = buildRawDocument([page]);
    const layout = await new LayoutEngine().analyze(raw);
    const idm = await new IntermediateDocumentEngine().build(raw, layout);
    const typography = await new TypographyAnalyzer().analyze(idm);
    const semantic = await new SemanticStructureEngine().generate({ idm, layout, typography });
    const engine = new GraphicsReconstructionEngine();
    const input = { semantic, layout, raw, tables: null };
    expect(engine.DetectImages(input).length).toBeGreaterThanOrEqual(1);
    expect(engine.GenerateGraphicsModel(input).graphics.rootIds.length).toBeGreaterThanOrEqual(1);
  });

  it('produces no DOCX/PPTX export artifacts', async () => {
    const page = buildPage({ chars: wordChars('x', 72, 400, 12), images: [{ x: 100, y: 500, w: 40, h: 40 }] });
    const raw = buildRawDocument([page]);
    const layout = await new LayoutEngine().analyze(raw);
    const idm = await new IntermediateDocumentEngine().build(raw, layout);
    const typography = await new TypographyAnalyzer().analyze(idm);
    const semantic = await new SemanticStructureEngine().generate({ idm, layout, typography });
    const result = new GraphicsReconstructionEngine().GenerateGraphicsModel({
      semantic,
      layout,
      raw,
    });
    const json = JSON.stringify(result);
    expect(json).not.toMatch(/docx|pptx|spreadsheetml/i);
  });

  it('container exposes graphics engine', () => {
    const c = createContainer({
      memoryStorage: true,
      configOverrides: { 'telemetry.enabled': false },
    });
    expect(c.graphics.name).toBe('GraphicsReconstructionEngine');
  });
});
