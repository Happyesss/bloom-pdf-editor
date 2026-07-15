import { createId } from '../../utils/id.js';
import type { ITocDetector, StructureEngineInput } from './algorithms/types.js';
import type { TocEntry } from './types.js';

const TOC_HEADING_RE = /^\s*(table\s+of\s+contents|contents|toc)\s*$/i;
const LEADER_RE = /\.{2,}|\u2026|\s{2,}\d+\s*$/;
const ENTRY_RE = /^(.+?)\s*(?:\.{2,}|\u2026|\s{2,})\s*(\d{1,4}|[ivxlcdmIVXLCDM]+)\s*$/;

/**
 * Detect generated/manual TOC entries with leader dots and page refs.
 */
export class TocDetector implements ITocDetector {
  readonly name = 'TocDetector';

  detect(input: StructureEngineInput): TocEntry[] {
    const nodes = Object.values(input.semantic.nodes).sort(
      (a, b) => a.readingOrderIndex - b.readingOrderIndex,
    );

    let inToc = false;
    let tocPage: number | null = null;
    const entries: TocEntry[] = [];

    for (const n of nodes) {
      if (!('text' in n) || !n.text) continue;
      const text = String(n.text).trim();
      if (!text) continue;

      if (TOC_HEADING_RE.test(text) || (n.type === 'heading' && /contents/i.test(text))) {
        inToc = true;
        tocPage = n.pageIndex;
        continue;
      }

      // Leave TOC after a large vertical gap / new major heading far from TOC page
      if (inToc && tocPage != null && n.pageIndex > tocPage + 2) {
        inToc = false;
      }
      if (inToc && n.type === 'heading' && 'level' in n && (n.level as number) <= 1 && entries.length > 3) {
        if (!LEADER_RE.test(text)) inToc = false;
      }

      const parsed = parseEntry(text);
      if (parsed && (inToc || LEADER_RE.test(text))) {
        if (!inToc && LEADER_RE.test(text)) inToc = true;
        const target = findHeading(input, parsed.title);
        entries.push({
          id: createId('toc'),
          title: parsed.title,
          level: inferLevel(n, parsed.title),
          pageLabel: parsed.pageLabel,
          pageIndex: parsed.pageLabel ? labelToIndex(parsed.pageLabel) : undefined,
          targetHeadingId: target?.id,
          hasLeaderDots: /\.{2,}|\u2026/.test(text),
          confidence: inToc ? 0.85 : 0.6,
        });
      }
    }

    return entries;
  }
}

function parseEntry(text: string): { title: string; pageLabel: string } | null {
  const m = text.match(ENTRY_RE);
  if (!m) return null;
  return { title: m[1]!.trim(), pageLabel: m[2]!.trim() };
}

function inferLevel(
  node: { type: string; level?: number },
  title: string,
): number {
  if (typeof node.level === 'number') return Math.min(6, Math.max(1, node.level));
  const indent = title.match(/^(\s+)/);
  if (indent) return Math.min(4, 1 + Math.floor(indent[1]!.length / 2));
  return 1;
}

function findHeading(input: StructureEngineInput, title: string) {
  const norm = title.toLowerCase().replace(/\s+/g, ' ').trim();
  for (const n of Object.values(input.semantic.nodes)) {
    if (n.type !== 'heading' && n.type !== 'title' && n.type !== 'subtitle') continue;
    const t = 'text' in n ? String(n.text ?? '').toLowerCase().replace(/\s+/g, ' ').trim() : '';
    if (t === norm || t.includes(norm) || norm.includes(t)) return n;
  }
  return null;
}

function labelToIndex(label: string): number | undefined {
  if (/^\d+$/.test(label)) return Math.max(0, Number(label) - 1);
  return undefined;
}
