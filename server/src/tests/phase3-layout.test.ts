import { describe, it, expect } from 'vitest';
import { LayoutEngine } from '../engines/layout/layout-engine.js';
import { LayoutSpatialIndex } from '../engines/layout/spatial-index.js';
import { IntermediateDocumentEngine } from '../engines/idm/idm-engine.js';
import { FORBIDDEN_REGION_KINDS } from '../engines/layout/algorithms/types.js';
import {
  buildPage,
  buildRawDocument,
  lineOfWords,
  wordChars,
} from './helpers/raw-fixtures.js';

describe('Phase 3 — Layout Analysis Engine', () => {
  const engine = new LayoutEngine({ concurrency: 2 });

  it('single-column body → text_block regions with top-to-bottom reading order', async () => {
    // Place body in the middle of the page so it is not a header/footer band.
    const chars = [
      ...lineOfWords(['Hello', 'world', 'body'], 72, 520, 12),
      ...lineOfWords(['Second', 'line', 'here'], 72, 500, 12),
      ...lineOfWords(['Third', 'line', 'text'], 72, 480, 12),
    ];
    const raw = buildRawDocument([buildPage({ chars })]);
    const layout = await engine.analyze(raw);

    expect(layout.pages).toHaveLength(1);
    const page = layout.pages[0]!;
    expect(page.regions.length).toBeGreaterThanOrEqual(1);
    expect(page.regions.every((r) => !FORBIDDEN_REGION_KINDS.has(r.kind))).toBe(true);
    expect(page.regions.some((r) => r.kind === 'text_block' || r.kind === 'heading')).toBe(true);

    const order = page.readingOrder.order;
    expect(order.length).toBe(page.regions.length);
    // Reading indices are sequential
    const indices = page.regions.map((r) => r.readingOrderIndex).sort((a, b) => a - b);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(order.length - 1);
  });

  it('header band + body → header then text_block in reading order', async () => {
    const chars = [
      ...lineOfWords(['Document', 'Title', 'Header'], 72, 760, 11),
      ...lineOfWords(['Body', 'paragraph', 'one'], 72, 600, 12),
      ...lineOfWords(['Body', 'paragraph', 'two'], 72, 580, 12),
    ];
    const raw = buildRawDocument([buildPage({ chars })]);
    const layout = await engine.analyze(raw);
    const page = layout.pages[0]!;

    const kinds = page.readingOrder.order.map(
      (id) => page.regions.find((r) => r.id === id)!.kind,
    );

    expect(kinds.some((k) => k === 'header')).toBe(true);
    const headerIdx = kinds.indexOf('header');
    const bodyIdx = kinds.findIndex((k) => k === 'text_block' || k === 'heading');
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    expect(bodyIdx).toBeGreaterThan(headerIdx);
  });

  it('two-column gutter → LTR column reading order (not interleaved Y-sort)', async () => {
    // Left column: three lines at y=700,680,660
    // Right column: three lines at y=700,680,660 but x=340
    // Pure Y-sort would interleave L0,R0,L1,R1,...
    // Column-aware order should be all left then all right (or regions per column).
    const chars = [
      ...lineOfWords(['Left', 'alpha'], 50, 700, 12),
      ...lineOfWords(['Left', 'beta'], 50, 680, 12),
      ...lineOfWords(['Left', 'gamma'], 50, 660, 12),
      ...lineOfWords(['Right', 'alpha'], 340, 700, 12),
      ...lineOfWords(['Right', 'beta'], 340, 680, 12),
      ...lineOfWords(['Right', 'gamma'], 340, 660, 12),
    ];
    const raw = buildRawDocument([buildPage({ chars })]);
    const layout = await engine.analyze(raw);
    const page = layout.pages[0]!;

    expect(page.regions.length).toBeGreaterThanOrEqual(2);

    // Collect text in reading order
    const texts = page.readingOrder.order.map((id) => {
      const r = page.regions.find((x) => x.id === id)!;
      return r.blocks.map((b) => b.text ?? '').join(' ');
    });

    const joined = texts.join(' || ');
    const firstLeft = joined.indexOf('Left');
    const firstRight = joined.indexOf('Right');
    expect(firstLeft).toBeGreaterThanOrEqual(0);
    expect(firstRight).toBeGreaterThanOrEqual(0);
    // Left column content should appear before right column content overall
    expect(firstLeft).toBeLessThan(firstRight);

    // Must not be strict Y-interleave: "Left alpha" then immediately "Right alpha" as only pattern
    // If column-aware, after first Left region we should see more Left before Right
    const leftPositions: number[] = [];
    const rightPositions: number[] = [];
    texts.forEach((t, i) => {
      if (t.includes('Left')) leftPositions.push(i);
      if (t.includes('Right')) rightPositions.push(i);
    });
    if (leftPositions.length && rightPositions.length) {
      expect(Math.max(...leftPositions)).toBeLessThanOrEqual(Math.min(...rightPositions) + leftPositions.length);
      // Stronger: max left index < min right index when columns are separate regions
      if (page.regions.length >= 2) {
        expect(Math.max(...leftPositions)).toBeLessThan(Math.min(...rightPositions));
      }
    }
  });

  it('image + caption proximity → image region (and caption when small text below)', async () => {
    const chars = [
      ...wordChars('Figure caption below', 100, 380, 9),
    ];
    const raw = buildRawDocument([
      buildPage({
        chars,
        images: [{ x: 100, y: 420, w: 200, h: 120 }],
      }),
    ]);
    const layout = await engine.analyze(raw);
    const page = layout.pages[0]!;
    const kinds = page.regions.map((r) => r.kind);

    expect(kinds).toContain('image');
    // Caption may be classified as caption or text_block depending on proximity
    expect(kinds.some((k) => k === 'caption' || k === 'text_block')).toBe(true);
  });

  it('never emits paragraph or table region kinds', async () => {
    const chars = [
      ...lineOfWords(['A', 'B', 'C'], 72, 700),
      ...lineOfWords(['D', 'E', 'F'], 72, 680),
    ];
    const layout = await engine.analyze(buildRawDocument([buildPage({ chars })]));
    for (const page of layout.pages) {
      for (const r of page.regions) {
        expect(FORBIDDEN_REGION_KINDS.has(r.kind)).toBe(false);
        expect(String(r.kind)).not.toBe('paragraph');
        expect(String(r.kind)).not.toBe('table');
      }
    }
  });

  it('layout feeds IDM reconstruction (Phase 4 fills blocks from regions)', async () => {
    const chars = lineOfWords(['Only', 'layout'], 72, 520);
    const raw = buildRawDocument([buildPage({ chars })]);
    const layout = await engine.analyze(raw);
    const idm = await new IntermediateDocumentEngine().build(raw, layout);

    expect(layout.pages[0]!.regions.length).toBeGreaterThanOrEqual(1);
    expect(idm.sections[0]!.pages[0]!.blocks.length).toBeGreaterThanOrEqual(1);
  });

  it('spatial index supports byFont and intersecting rect', () => {
    const index = new LayoutSpatialIndex(50);
    index.insert({
      id: 'c1',
      type: 'character',
      bbox: { x: 10, y: 10, width: 8, height: 12 },
      fontName: 'Helvetica',
      fontSize: 12,
      styleKey: 'Helvetica|12|400',
      zIndex: 1,
    });
    index.insert({
      id: 'c2',
      type: 'character',
      bbox: { x: 100, y: 100, width: 8, height: 12 },
      fontName: 'Times',
      fontSize: 14,
      styleKey: 'Times|14|400',
      zIndex: 2,
    });

    expect(index.objectsByFont('Helvetica')).toHaveLength(1);
    expect(index.objectsByStyle('Times|14|400')).toHaveLength(1);
    expect(
      index.objectsIntersectingRectangle({ x: 8, y: 8, width: 20, height: 20 }),
    ).toHaveLength(1);
    expect(
      index.objectsInsideRectangle({ x: 0, y: 0, width: 200, height: 200 }),
    ).toHaveLength(2);
  });

  it('parallel multi-page analyze returns stable page indices', async () => {
    const pages = [0, 1, 2].map((index) =>
      buildPage({
        index,
        chars: lineOfWords([`Page${index}`], 72, 700 - index * 10),
      }),
    );
    const layout = await engine.analyze(buildRawDocument(pages));
    expect(layout.pages.map((p) => p.pageIndex)).toEqual([0, 1, 2]);
    expect(layout.pages.every((p) => p.regions.length >= 1)).toBe(true);
  });
});
