import { createId } from '../../utils/id.js';
import type { StyleProfile, StyleSample, TypographyFeatures } from './types.js';

/** Quantize features into a cluster key (visual similarity, not semantics). */
export function clusterKey(f: TypographyFeatures): string {
  return [
    normalizeFont(f.fontFamily),
    quantizeSize(f.fontSize),
    f.bold ? 'B' : 'b',
    f.italic ? 'I' : 'i',
    f.underline ? 'U' : 'u',
    Math.round(f.fontWeight / 100) * 100,
    f.alignment,
    quantizeSize(f.lineHeight),
    (f.textColor ?? '').toLowerCase(),
  ].join('|');
}

export function clusterSamples(samples: StyleSample[]): StyleProfile[] {
  const buckets = new Map<string, StyleSample[]>();
  for (const s of samples) {
    const key = clusterKey(s.features);
    let arr = buckets.get(key);
    if (!arr) {
      arr = [];
      buckets.set(key, arr);
    }
    arr.push(s);
  }

  const total = Math.max(samples.length, 1);
  const profiles: StyleProfile[] = [];

  for (const [key, group] of buckets) {
    const features = averageFeatures(group.map((g) => g.features));
    const occurrenceCount = group.length;
    profiles.push({
      id: createId('style'),
      features,
      confidence: Math.min(0.99, 0.5 + occurrenceCount / total),
      occurrenceCount,
      sampleBlockIds: group.map((g) => g.blockId),
      clusterKey: key,
    });
  }

  return profiles.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
}

function normalizeFont(name: string): string {
  return name
    .replace(/[,].*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase() || 'unknown';
}

function quantizeSize(n: number): number {
  return Math.round(n * 2) / 2;
}

function averageFeatures(list: TypographyFeatures[]): TypographyFeatures {
  const first = list[0]!;
  const avg = (pick: (f: TypographyFeatures) => number) =>
    list.reduce((s, f) => s + pick(f), 0) / list.length;

  const boolMajority = (pick: (f: TypographyFeatures) => boolean) =>
    list.filter(pick).length >= list.length / 2;

  const alignCounts = new Map<string, number>();
  for (const f of list) {
    alignCounts.set(f.alignment, (alignCounts.get(f.alignment) ?? 0) + 1);
  }
  let alignment = first.alignment;
  let best = 0;
  for (const [a, n] of alignCounts) {
    if (n > best) {
      best = n;
      alignment = a as TypographyFeatures['alignment'];
    }
  }

  const colorCounts = new Map<string, number>();
  for (const f of list) {
    if (f.textColor) colorCounts.set(f.textColor, (colorCounts.get(f.textColor) ?? 0) + 1);
  }
  let textColor = first.textColor;
  best = 0;
  for (const [c, n] of colorCounts) {
    if (n > best) {
      best = n;
      textColor = c;
    }
  }

  return {
    fontFamily: first.fontFamily,
    fontSize: avg((f) => f.fontSize),
    bold: boolMajority((f) => f.bold),
    italic: boolMajority((f) => f.italic),
    underline: boolMajority((f) => f.underline),
    strike: boolMajority((f) => f.strike),
    superscript: boolMajority((f) => f.superscript),
    subscript: boolMajority((f) => f.subscript),
    fontWeight: Math.round(avg((f) => f.fontWeight)),
    letterSpacing: avg((f) => f.letterSpacing),
    wordSpacing: avg((f) => f.wordSpacing),
    lineHeight: avg((f) => f.lineHeight),
    paragraphSpacing: avg((f) => f.paragraphSpacing),
    textColor,
    backgroundColor: first.backgroundColor,
    opacity: avg((f) => f.opacity),
    writingDirection: first.writingDirection,
    rotation: avg((f) => f.rotation),
    alignment,
    firstLineIndent: avg((f) => f.firstLineIndent),
    hangingIndent: avg((f) => f.hangingIndent),
    leftIndent: avg((f) => f.leftIndent),
  };
}
