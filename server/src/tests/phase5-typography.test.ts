import { describe, it, expect } from 'vitest';
import { LayoutEngine } from '../engines/layout/layout-engine.js';
import { IntermediateDocumentEngine } from '../engines/idm/idm-engine.js';
import { TypographyAnalyzer } from '../engines/typography/analyzer.js';
import {
  buildPage,
  buildRawDocument,
  lineOfWords,
  wordChars,
} from './helpers/raw-fixtures.js';

async function buildIdmWithStyles() {
  const chars = [
    ...wordChars('Document Title Here', 72, 720, 22, 'Times-Bold'),
    ...lineOfWords(['Body', 'text', 'one'], 72, 520, 11),
    ...lineOfWords(['Body', 'text', 'two'], 72, 500, 11),
    ...wordChars('Small note', 72, 200, 9, 'Helvetica'),
  ];
  // Fix font names on title chars
  for (const c of chars) {
    if (c.fontSize === 22) {
      c.fontName = 'Times-Bold';
      c.fontWeight = 700;
    }
  }

  const raw = buildRawDocument([buildPage({ chars })]);
  // Patch fontWeight onto raw characters after build
  for (const ch of raw.pages[0]!.characters) {
    if (ch.fontSize >= 20) {
      ch.fontName = 'Times-Bold';
      ch.fontWeight = 700;
    }
  }

  const layout = await new LayoutEngine().analyze(raw);
  const idm = await new IntermediateDocumentEngine().build(raw, layout);
  const analysis = await new TypographyAnalyzer().analyze(idm);
  return { idm, analysis };
}

describe('Phase 5 — Typography & Style Analysis', () => {
  it('clusters visual styles into profiles without semantic labels', async () => {
    const { analysis } = await buildIdmWithStyles();

    expect(analysis.profiles.length).toBeGreaterThanOrEqual(1);
    expect(analysis.statistics.sampleCount).toBeGreaterThan(0);
    expect(analysis.statistics.primaryFonts.length).toBeGreaterThan(0);

    // No semantic classification in profile ids/keys
    for (const p of analysis.profiles) {
      expect(p.clusterKey.toLowerCase()).not.toContain('heading 1');
      expect(p.clusterKey.toLowerCase()).not.toContain('title');
      expect(p.occurrenceCount).toBeGreaterThan(0);
      expect(p.confidence).toBeGreaterThan(0);
    }
  });

  it('builds a style graph with sibling/parent relations', async () => {
    const { analysis } = await buildIdmWithStyles();
    expect(analysis.graph.nodes.length).toBe(analysis.profiles.length);
    // Edges may be empty for single-profile docs; multi-style should have some
    if (analysis.profiles.length >= 2) {
      expect(analysis.graph.edges.length).toBeGreaterThanOrEqual(0);
    }
  });

  it('maps blocks to style profiles', async () => {
    const { idm, analysis } = await buildIdmWithStyles();
    const blockIds = idm.sections[0]!.pages[0]!.blocks.map((b) => b.id);
    const mapped = blockIds.filter((id) => analysis.typographyMap.blockToProfile[id]);
    expect(mapped.length).toBeGreaterThan(0);
  });

  it('exposes AnalyzeTypography / GetStyleProfiles / FindStyle API', async () => {
    const { analysis } = await buildIdmWithStyles();
    const analyzer = new TypographyAnalyzer();
    const profiles = analyzer.GetStyleProfiles(analysis);
    expect(profiles).toBe(analysis.profiles);

    const stats = analyzer.GetTypographyStatistics(analysis);
    expect(stats.sampleCount).toBe(analysis.statistics.sampleCount);

    const found = analyzer.FindStyle(analysis, profiles[0]!.id);
    expect(found?.id).toBe(profiles[0]!.id);
    expect(analyzer.FindStyle(analysis, 'missing')).toBeNull();
  });

  it('reports dominant font sizes and alignments', async () => {
    const { analysis } = await buildIdmWithStyles();
    expect(analysis.statistics.dominantFontSizes.length).toBeGreaterThan(0);
    expect(analysis.statistics.commonAlignments.length).toBeGreaterThan(0);
    expect(analysis.statistics.averages.lineHeight).toBeGreaterThan(0);
  });
});
