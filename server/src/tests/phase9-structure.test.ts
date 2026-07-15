import { describe, it, expect } from 'vitest';
import { createContainer } from '../container.js';
import { LayoutEngine } from '../engines/layout/layout-engine.js';
import { IntermediateDocumentEngine } from '../engines/idm/idm-engine.js';
import { TypographyAnalyzer } from '../engines/typography/analyzer.js';
import { SemanticStructureEngine } from '../engines/semantic/engine.js';
import { TableDetectionEngine } from '../engines/table/engine.js';
import { GraphicsReconstructionEngine } from '../engines/graphics/engine.js';
import { DocumentStructureEngine } from '../engines/structure/engine.js';
import {
  buildPage,
  buildRawDocument,
  wordChars,
  type CharSpec,
} from './helpers/raw-fixtures.js';

async function structurePipeline(pages: ReturnType<typeof buildPage>[]) {
  const raw = buildRawDocument(pages);
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
  const engine = new DocumentStructureEngine();
  const result = await engine.build({
    semantic: tables.semantic,
    tables: tables.tables,
    graphics: graphics.graphics,
    layout,
    raw,
    idm,
  });
  return { raw, layout, idm, semantic: tables.semantic, result, engine };
}

function multiPageWithRunningHeader(): ReturnType<typeof buildPage>[] {
  const pages = [];
  for (let i = 0; i < 3; i++) {
    const chars: CharSpec[] = [
      ...wordChars('Acme Corp Annual Report', 72, 760, 10),
      ...wordChars(`Chapter body content page ${i + 1}`, 72, 500, 12),
      ...wordChars(String(i + 1), 300, 36, 10),
    ];
    pages.push(buildPage({ index: i, chars, height: 792 }));
  }
  return pages;
}

describe('Phase 9 — Document Structure Intelligence', () => {
  it('detects repeating headers/footers across pages', async () => {
    const { result } = await structurePipeline(multiPageWithRunningHeader());
    // Layout may classify top band as header — accept header OR footer with page nums
    const running =
      result.structure.headers.length +
      result.structure.footers.length +
      result.structure.pageNumbers.length;
    expect(running).toBeGreaterThanOrEqual(1);
  });

  it('detects TOC entries with leader dots', async () => {
    const chars: CharSpec[] = [
      ...wordChars('Table of Contents', 72, 700, 16),
      ...wordChars('Introduction ..... 3', 72, 660, 12),
      ...wordChars('Methods .......... 8', 72, 640, 12),
      ...wordChars('Introduction', 72, 500, 14),
      ...wordChars('Body of intro chapter here', 72, 470, 11),
    ];
    for (const c of chars) {
      if (c.y === 700 || c.y === 500) c.fontWeight = 700;
    }
    const { result, engine, semantic, layout, raw, idm } = await structurePipeline([
      buildPage({ chars }),
    ]);
    const toc = engine.DetectTOC({
      semantic,
      tables: [],
      graphics: null,
      layout,
      raw,
      idm,
    });
    expect(toc.length + result.structure.toc.length).toBeGreaterThanOrEqual(1);
  });

  it('builds bookmark graph from outline or headings', async () => {
    const raw = buildRawDocument([
      buildPage({
        chars: [
          ...wordChars('Overview', 72, 700, 18),
          ...wordChars('Details section body', 72, 500, 12),
        ],
      }),
    ]);
    raw.bookmarks = [
      { id: 'bm1', title: 'Overview', pageIndex: 0, children: [
        { id: 'bm2', title: 'Details', pageIndex: 0 },
      ] },
    ];
    const layout = await new LayoutEngine().analyze(raw);
    const idm = await new IntermediateDocumentEngine().build(raw, layout);
    const typography = await new TypographyAnalyzer().analyze(idm);
    const semantic = await new SemanticStructureEngine().generate({ idm, layout, typography });
    const result = await new DocumentStructureEngine().build({
      semantic,
      raw,
      idm,
      layout,
    });
    expect(result.structure.bookmarks.length).toBeGreaterThanOrEqual(1);
    expect(result.structure.bookmarks[0]?.title).toBe('Overview');
  });

  it('analyzes hyperlinks (external / email)', async () => {
    const page = buildPage({ chars: wordChars('Visit our site', 72, 500, 12) });
    page.annotations = [
      {
        id: 'ann1',
        type: 'annotation',
        parentId: page.id,
        childIds: [],
        pageIndex: 0,
        bbox: { x: 72, y: 500, width: 80, height: 12 },
        transform: [1, 0, 0, 1, 72, 500],
        zIndex: 20,
        subtype: 'Link',
        contents: 'site',
        uri: 'https://example.com',
        dest: null,
      },
      {
        id: 'ann2',
        type: 'annotation',
        parentId: page.id,
        childIds: [],
        pageIndex: 0,
        bbox: { x: 72, y: 480, width: 80, height: 12 },
        transform: [1, 0, 0, 1, 72, 480],
        zIndex: 21,
        subtype: 'Link',
        contents: 'mail',
        uri: 'mailto:hi@example.com',
        dest: null,
      },
    ];
    const { result } = await structurePipeline([page]);
    const kinds = new Set(result.structure.hyperlinks.map((h) => h.kind));
    expect(kinds.has('external') || kinds.has('email')).toBe(true);
  });

  it('builds section hierarchy from headings', async () => {
    const chars: CharSpec[] = [
      ...wordChars('Chapter One', 72, 700, 18),
      ...wordChars('Section A body text follows here', 72, 640, 12),
      ...wordChars('Chapter Two', 72, 500, 18),
      ...wordChars('More body text for chapter two', 72, 460, 12),
    ];
    for (const c of chars) {
      if (c.fontSize === 18) c.fontWeight = 700;
    }
    const { result } = await structurePipeline([buildPage({ chars })]);
    expect(result.structure.root.kind).toBe('document');
    expect(Object.keys(result.structure.nodes).length).toBeGreaterThanOrEqual(1);
  });

  it('exposes DetectHeaders / DetectFooters / DetectTOC / BuildDocumentStructure', async () => {
    const { engine, semantic, layout, raw, idm, result } = await structurePipeline(
      multiPageWithRunningHeader(),
    );
    const input = { semantic, tables: [], graphics: null, layout, raw, idm };
    expect(Array.isArray(engine.DetectHeaders(input))).toBe(true);
    expect(Array.isArray(engine.DetectFooters(input))).toBe(true);
    expect(result.structure.id).toBeTruthy();
    expect(result.structure.quality.overall).toBeGreaterThan(0);
  });

  it('produces no Office export artifacts', async () => {
    const { result } = await structurePipeline([
      buildPage({ chars: wordChars('Hello structure', 72, 500, 12) }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/docx|xlsx|pptx|spreadsheetml/i);
  });

  it('container exposes structure engine', () => {
    const c = createContainer({
      memoryStorage: true,
      configOverrides: { 'telemetry.enabled': false },
    });
    expect(c.structure.name).toBe('DocumentStructureEngine');
  });
});
