import { createId } from '../../utils/id.js';
import type { Block, IntermediateDocument, Run } from '../idm/types.js';
import { clusterKey, clusterSamples } from './clustering.js';
import { buildStyleGraph } from './style-graph.js';
import type {
  StyleProfile,
  StyleSample,
  TypographyAnalysis,
  TypographyFeatures,
  TypographyStatistics,
} from './types.js';

/**
 * Phase 5 — Typography & Style Analysis Engine.
 * Identifies visual styles only — never Heading/Title/List/Caption semantics.
 */
export class TypographyAnalyzer {
  readonly name = 'TypographyAnalyzer' as const;

  async analyze(idm: IntermediateDocument): Promise<TypographyAnalysis> {
    return this.AnalyzeTypography(idm);
  }

  AnalyzeTypography(idm: IntermediateDocument): TypographyAnalysis {
    const samples = collectSamples(idm);
    const profiles = clusterSamples(samples);
    const graph = buildStyleGraph(profiles);
    const typographyMap = {
      blockToProfile: {} as Record<string, string>,
      runToProfile: {} as Record<string, string>,
    };

    const profileByKey = new Map(profiles.map((p) => [p.clusterKey, p]));
    for (const s of samples) {
      const key = clusterKey(s.features);
      const profile = profileByKey.get(key);
      if (profile) typographyMap.blockToProfile[s.blockId] = profile.id;
    }

    // Map runs
    for (const block of iterTextBlocks(idm)) {
      for (const run of block.runs) {
        const features = featuresFromRun(run, block);
        const profile = profileByKey.get(clusterKey(features));
        if (profile) typographyMap.runToProfile[run.id] = profile.id;
      }
    }

    const statistics = buildStatistics(samples, profiles, idm);

    return {
      id: createId('typo'),
      sourceDocumentId: idm.id,
      profiles,
      graph,
      statistics,
      typographyMap,
      samples,
    };
  }

  GetStyleProfiles(analysis: TypographyAnalysis): StyleProfile[] {
    return analysis.profiles;
  }

  GetTypographyStatistics(analysis: TypographyAnalysis): TypographyStatistics {
    return analysis.statistics;
  }

  FindStyle(analysis: TypographyAnalysis, profileId: string): StyleProfile | null {
    return analysis.profiles.find((p) => p.id === profileId) ?? null;
  }
}

function collectSamples(idm: IntermediateDocument): StyleSample[] {
  const samples: StyleSample[] = [];
  const pages = idm.sections.flatMap((s) => s.pages);

  for (const page of pages) {
    const blocks = [
      ...page.blocks,
      ...page.headers.flatMap((h) => h.blocks),
      ...page.footers.flatMap((f) => f.blocks),
    ];

    // paragraph spacing from consecutive text blocks
    const textBlocks = blocks.filter(isTextBlock);
    for (let i = 0; i < textBlocks.length; i++) {
      const block = textBlocks[i]!;
      const next = textBlocks[i + 1];
      const paragraphSpacing =
        next && block.bbox && next.bbox
          ? Math.max(0, block.bbox.y - (next.bbox.y + next.bbox.height))
          : 0;

      const features = featuresFromBlock(block, paragraphSpacing, page.width);
      const textLength =
        block.runs.reduce((n, r) => n + r.text.replace(/\s/g, '').length, 0) ||
        block.characters.length;

      samples.push({
        blockId: block.id,
        pageIndex: page.index,
        features,
        textLength,
      });
    }
  }

  return samples;
}

function isTextBlock(block: Block): block is Block & { runs: Run[]; characters: unknown[] } {
  return (
    block.type !== 'image' &&
    'runs' in block &&
    Array.isArray(block.runs)
  );
}

function featuresFromBlock(
  block: Block & { runs: Run[] },
  paragraphSpacing: number,
  pageWidth: number,
): TypographyFeatures {
  const run = block.runs[0];
  const chars = 'characters' in block ? block.characters : [];
  const fontSize = run?.fontSize ?? median(chars.map((c) => (c as { fontSize?: number }).fontSize ?? 12)) ?? 12;
  const fontName = run?.fontName ?? 'Unknown';
  const bold = run?.bold ?? (run?.fontWeight ?? 400) >= 700;
  const italic = run?.italic ?? false;

  const lineHeight = estimateLineHeight(block, fontSize);
  const alignment = block.alignment ?? 'left';
  const leftIndent = block.bbox ? block.bbox.x : 0;
  const firstLineIndent = 0;
  const hangingIndent = 0;

  // Detect indent relative to page
  void pageWidth;

  return {
    fontFamily: fontName,
    fontSize,
    bold,
    italic,
    underline: run?.underline ?? false,
    strike: run?.strike ?? false,
    superscript: run?.superscript ?? false,
    subscript: run?.subscript ?? false,
    fontWeight: run?.fontWeight ?? (bold ? 700 : 400),
    letterSpacing: run?.characterSpacing ?? 0,
    wordSpacing: run?.wordSpacing ?? 0,
    lineHeight,
    paragraphSpacing,
    textColor: run?.color,
    backgroundColor: run?.backgroundColor,
    opacity: 1,
    writingDirection: block.writingDirection ?? run?.writingDirection ?? 'ltr',
    rotation: block.rotation ?? run?.rotation ?? 0,
    alignment: alignment === 'mixed' ? 'mixed' : alignment,
    firstLineIndent,
    hangingIndent,
    leftIndent,
  };
}

function featuresFromRun(run: Run, block: Block): TypographyFeatures {
  const bold = run.bold ?? (run.fontWeight ?? 400) >= 700;
  return {
    fontFamily: run.fontName ?? 'Unknown',
    fontSize: run.fontSize ?? 12,
    bold,
    italic: run.italic ?? false,
    underline: run.underline ?? false,
    strike: run.strike ?? false,
    superscript: run.superscript ?? false,
    subscript: run.subscript ?? false,
    fontWeight: run.fontWeight ?? (bold ? 700 : 400),
    letterSpacing: run.characterSpacing ?? 0,
    wordSpacing: run.wordSpacing ?? 0,
    lineHeight: (run.fontSize ?? 12) * 1.2,
    paragraphSpacing: 0,
    textColor: run.color,
    backgroundColor: run.backgroundColor,
    opacity: 1,
    writingDirection: run.writingDirection ?? block.writingDirection ?? 'ltr',
    rotation: run.rotation ?? 0,
    alignment: block.alignment ?? 'left',
    firstLineIndent: 0,
    hangingIndent: 0,
    leftIndent: block.bbox?.x ?? 0,
  };
}

function estimateLineHeight(block: Block & { runs: Run[] }, fontSize: number): number {
  if (!block.bbox || !('words' in block) || block.words.length < 2) {
    return fontSize * 1.2;
  }
  // Approximate from block height / line count (newlines in text)
  const text = block.runs.map((r) => r.text).join('');
  const lines = Math.max(1, text.split(/\n/).length);
  return block.bbox.height / lines;
}

function buildStatistics(
  samples: StyleSample[],
  profiles: StyleProfile[],
  idm: IntermediateDocument,
): TypographyStatistics {
  const fontCounts = new Map<string, number>();
  const sizeCounts = new Map<number, number>();
  const colorCounts = new Map<string, number>();
  const alignCounts = new Map<string, number>();

  let charSp = 0;
  let wordSp = 0;
  let lineH = 0;
  let paraGap = 0;

  for (const s of samples) {
    const f = s.features;
    fontCounts.set(f.fontFamily, (fontCounts.get(f.fontFamily) ?? 0) + 1);
    const size = Math.round(f.fontSize * 2) / 2;
    sizeCounts.set(size, (sizeCounts.get(size) ?? 0) + 1);
    if (f.textColor) colorCounts.set(f.textColor, (colorCounts.get(f.textColor) ?? 0) + 1);
    alignCounts.set(f.alignment, (alignCounts.get(f.alignment) ?? 0) + 1);
    charSp += f.letterSpacing;
    wordSp += f.wordSpacing;
    lineH += f.lineHeight;
    paraGap += f.paragraphSpacing;
  }

  const n = Math.max(samples.length, 1);
  const fontRanked = [...fontCounts.entries()]
    .map(([font, count]) => ({ font, count, share: count / n }))
    .sort((a, b) => b.count - a.count);

  const margins = estimateMargins(idm);

  return {
    primaryFonts: fontRanked.slice(0, 3),
    secondaryFonts: fontRanked.slice(3, 8),
    colorPalette: [...colorCounts.entries()]
      .map(([color, count]) => ({ color, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    dominantFontSizes: [...sizeCounts.entries()]
      .map(([size, count]) => ({ size, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8),
    commonAlignments: [...alignCounts.entries()]
      .map(([alignment, count]) => ({ alignment, count }))
      .sort((a, b) => b.count - a.count),
    styleFrequency: profiles.map((p) => ({ profileId: p.id, count: p.occurrenceCount })),
    averages: {
      characterSpacing: charSp / n,
      wordSpacing: wordSp / n,
      lineHeight: lineH / n,
      paragraphGap: paraGap / n,
      sectionGap: paraGap / n * 2,
      pageMarginLeft: margins.left,
      pageMarginRight: margins.right,
      pageMarginTop: margins.top,
      pageMarginBottom: margins.bottom,
      columnGap: 0,
    },
    sampleCount: samples.length,
  };
}

function estimateMargins(idm: IntermediateDocument): {
  left: number;
  right: number;
  top: number;
  bottom: number;
} {
  let left = Infinity;
  let right = Infinity;
  let top = Infinity;
  let bottom = Infinity;

  for (const page of idm.sections.flatMap((s) => s.pages)) {
    for (const block of page.blocks) {
      if (!block.bbox) continue;
      left = Math.min(left, block.bbox.x);
      right = Math.min(right, page.width - (block.bbox.x + block.bbox.width));
      const regionTop = page.height - (block.bbox.y + block.bbox.height);
      top = Math.min(top, regionTop);
      bottom = Math.min(bottom, block.bbox.y);
    }
  }

  if (!Number.isFinite(left)) left = 0;
  if (!Number.isFinite(right)) right = 0;
  if (!Number.isFinite(top)) top = 0;
  if (!Number.isFinite(bottom)) bottom = 0;

  return { left, right, top, bottom };
}

function iterTextBlocks(idm: IntermediateDocument): Array<Block & { runs: Run[] }> {
  const out: Array<Block & { runs: Run[] }> = [];
  for (const page of idm.sections.flatMap((s) => s.pages)) {
    for (const block of page.blocks) {
      if (isTextBlock(block)) out.push(block);
    }
  }
  return out;
}

function median(values: number[]): number | undefined {
  const v = values.filter((n) => Number.isFinite(n));
  if (v.length === 0) return undefined;
  v.sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
}
