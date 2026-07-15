import { describe, it, expect } from 'vitest';
import { ParserEngine } from '../engines/parser/parser-engine.js';
import { PageSpatialIndex } from '../engines/parser/spatial-index.js';
import { ObjectGraph } from '../engines/parser/object-graph.js';
import { buildEmptyPagePdf, buildMinimalPdf } from './helpers/minimal-pdf.js';

describe('Phase 2 — PDF parsing & object extraction', () => {
  const parser = new ParserEngine();

  it('parses page boxes and metadata from empty PDF', async () => {
    const raw = await parser.parse(buildEmptyPagePdf());
    expect(raw.pages).toHaveLength(1);
    expect(raw.pages[0]!.width).toBe(612);
    expect(raw.pages[0]!.height).toBe(792);
    expect(raw.metadata.pdfVersion).toBe('1.7');
    expect(raw.objectGraph.size).toBeGreaterThan(0);
  });

  it('extracts characters and text runs without merging paragraphs', async () => {
    const raw = await parser.parse(buildMinimalPdf());
    const page = raw.pages[0]!;

    expect(page.characters.length).toBeGreaterThanOrEqual(2);
    expect(page.characters.map((c) => c.unicode).join('')).toContain('H');
    expect(page.textRuns.length).toBeGreaterThanOrEqual(1);
    expect(page.words).toHaveLength(0); // no word merging in Phase 2

    const ch = page.characters[0]!;
    expect(ch).toMatchObject({
      type: 'character',
      fontName: expect.any(String),
      fontSize: 12,
    });
    expect(ch.bbox.width).toBeGreaterThan(0);
  });

  it('builds object graph with parent/children links', async () => {
    const raw = await parser.parse(buildMinimalPdf());
    const page = raw.pages[0]!;
    const run = page.textRuns[0]!;
    const node = raw.objectGraph.get(run.id);
    expect(node).toBeDefined();
    expect(node!.type).toBe('textRun');
    expect(node!.childIds.length).toBeGreaterThan(0);

    const child = raw.objectGraph.get(node!.childIds[0]!);
    expect(child?.type).toBe('character');
    expect(child?.parentId).toBe(run.id);
  });

  it('spatial index supports nearest and rectangle queries', async () => {
    const raw = await parser.parse(buildMinimalPdf());
    const index = raw.pages[0]!.spatialIndex;

    const nearest = index.nearest(100, 700, 'character');
    expect(nearest).not.toBeNull();
    expect(nearest!.type).toBe('character');

    const inRect = index.objectsInRectangle(
      { x: 0, y: 0, width: 612, height: 792 },
      'character',
    );
    expect(inRect.length).toBeGreaterThan(0);

    expect(index.objectsByType('textRun').length).toBeGreaterThan(0);
  });

  it('PageSpatialIndex unit behavior', () => {
    const index = new PageSpatialIndex(50);
    index.insert({
      id: 'a',
      type: 'character',
      bbox: { x: 10, y: 10, width: 5, height: 5 },
      zIndex: 1,
    });
    index.insert({
      id: 'b',
      type: 'image',
      bbox: { x: 100, y: 100, width: 20, height: 20 },
      zIndex: 2,
      layer: 'images',
    });

    expect(index.nearest(12, 12)?.id).toBe('a');
    expect(index.objectsByLayer('images')).toHaveLength(1);
    expect(index.objectsInRectangle({ x: 90, y: 90, width: 50, height: 50 })).toHaveLength(1);
  });

  it('ObjectGraph tracks by type and page', () => {
    const g = new ObjectGraph();
    g.add({
      id: 'p0',
      type: 'page',
      parentId: null,
      childIds: [],
      pageIndex: 0,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      transform: [1, 0, 0, 1, 0, 0],
      zIndex: 0,
    });
    g.add({
      id: 'c0',
      type: 'character',
      parentId: 'p0',
      childIds: [],
      pageIndex: 0,
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      transform: [1, 0, 0, 1, 0, 0],
      zIndex: 1,
    });
    expect(g.byType('character')).toHaveLength(1);
    expect(g.children('p0')).toHaveLength(1);
  });

  it('supports lazy single-page parse API', async () => {
    const raw = await parser.parsePage(buildMinimalPdf(), 0);
    expect(raw.pages).toHaveLength(1);
    expect(raw.pages[0]!.index).toBe(0);
  });
});
