import { createId } from '../../utils/id.js';
import type { IPageNumberDetector, StructureEngineInput } from './algorithms/types.js';
import type { PageNumberEntry, PageNumberStyle, RunningRegion } from './types.js';

const ARABIC_RE = /^\s*(\d{1,4})\s*$/;
const ROMAN_RE = /^\s*([ivxlcdmIVXLCDM]{1,12})\s*$/;
const ALPHA_RE = /^\s*([A-Za-z])\s*$/;
const PAGE_OF_RE = /(?:page\s*)?(\d{1,4})\s*(?:of|\/)\s*\d{1,4}/i;

export class PageNumberDetector implements IPageNumberDetector {
  readonly name = 'PageNumberDetector';

  detect(input: StructureEngineInput, footers: RunningRegion[]): PageNumberEntry[] {
    const out: PageNumberEntry[] = [];
    const seen = new Set<number>();

    // From footer running regions (normalized '#' placeholders → recover from layout)
    for (const page of input.raw.pages) {
      const fromFooter = findInFooterBand(input, page.index, footers);
      if (fromFooter) {
        out.push(fromFooter);
        seen.add(page.index);
      }
    }

    // Scan layout footer/header regions for page-number-like tokens
    if (input.layout) {
      for (const page of input.layout.pages) {
        if (seen.has(page.pageIndex)) continue;
        for (const region of page.regions) {
          if (region.kind !== 'footer' && region.kind !== 'header') continue;
          const text = region.blocks.map((b) => b.text ?? '').join(' ').trim();
          const parsed = parsePageNumber(text, page.pageIndex);
          if (parsed) {
            out.push({ ...parsed, bbox: region.bbox });
            seen.add(page.pageIndex);
            break;
          }
        }
      }
    }

    return out.sort((a, b) => a.pageIndex - b.pageIndex);
  }
}

function findInFooterBand(
  input: StructureEngineInput,
  pageIndex: number,
  footers: RunningRegion[],
): PageNumberEntry | null {
  if (!input.layout) return null;
  const page = input.layout.pages.find((p) => p.pageIndex === pageIndex);
  if (!page) return null;

  for (const region of page.regions) {
    if (region.kind !== 'footer' && region.kind !== 'header') continue;
    const text = region.blocks.map((b) => b.text ?? '').join(' ').trim();
    const parsed = parsePageNumber(text, pageIndex);
    if (parsed) return { ...parsed, bbox: region.bbox };
  }

  // Footer text with # placeholder implies page numbers were stripped
  const matching = footers.filter((f) => f.pageIndices.includes(pageIndex));
  if (matching.some((f) => f.text.includes('#'))) {
    return {
      id: createId('pnum'),
      pageIndex,
      value: String(pageIndex + 1),
      style: 'arabic',
      numericValue: pageIndex + 1,
      confidence: 0.45,
    };
  }
  return null;
}

function parsePageNumber(text: string, pageIndex: number): PageNumberEntry | null {
  if (!text) return null;

  const ofMatch = text.match(PAGE_OF_RE);
  if (ofMatch) {
    const n = Number(ofMatch[1]);
    return entry(String(n), 'arabic', n, pageIndex, 0.9);
  }

  // Prefer short standalone tokens
  const tokens = text.split(/\s+/);
  for (const tok of tokens) {
    let m = tok.match(ARABIC_RE);
    if (m) return entry(m[1]!, 'arabic', Number(m[1]), pageIndex, 0.85);

    m = tok.match(ROMAN_RE);
    if (m && tok.length >= 1) {
      const n = romanToInt(m[1]!);
      if (n > 0) return entry(m[1]!, 'roman', n, pageIndex, 0.8);
    }

    m = tok.match(ALPHA_RE);
    if (m && tokens.length <= 3) {
      return entry(m[1]!, 'alphabetic', m[1]!.toUpperCase().charCodeAt(0) - 64, pageIndex, 0.6);
    }
  }

  if (/\d/.test(text) && /[A-Za-z]/.test(text) && text.length < 20) {
    const digits = text.match(/\d{1,4}/);
    if (digits) {
      return entry(text.trim(), 'mixed', Number(digits[0]), pageIndex, 0.55);
    }
  }

  return null;
}

function entry(
  value: string,
  style: PageNumberStyle,
  numericValue: number | undefined,
  pageIndex: number,
  confidence: number,
): PageNumberEntry {
  return {
    id: createId('pnum'),
    pageIndex,
    value,
    style,
    numericValue,
    confidence,
  };
}

function romanToInt(s: string): number {
  const map: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const t = s.toLowerCase();
  let n = 0;
  for (let i = 0; i < t.length; i++) {
    const cur = map[t[i]!] ?? 0;
    const next = map[t[i + 1]!] ?? 0;
    n += cur < next ? -cur : cur;
  }
  return n;
}
