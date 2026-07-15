import { createId } from '../../utils/id.js';
import type {
  IRunningRegionDetector,
  StructureEngineInput,
} from './algorithms/types.js';
import type { HeaderFooterVariant, RunningRegion } from './types.js';

/**
 * Detect repeating header/footer bands across pages.
 */
export class RunningRegionDetector implements IRunningRegionDetector {
  readonly name = 'RunningRegionDetector';

  detectHeaders(input: StructureEngineInput): RunningRegion[] {
    return detectBand(input, 'header');
  }

  detectFooters(input: StructureEngineInput): RunningRegion[] {
    return detectBand(input, 'footer');
  }
}

function detectBand(
  input: StructureEngineInput,
  kind: 'header' | 'footer',
): RunningRegion[] {
  const samples: Array<{ pageIndex: number; text: string; bbox?: RunningRegion['bboxSample'] }> =
    [];

  // Prefer layout-classified regions
  if (input.layout) {
    for (const page of input.layout.pages) {
      for (const region of page.regions) {
        if (region.kind !== kind) continue;
        const text = region.blocks
          .map((b) => (b.text ?? '').trim())
          .filter(Boolean)
          .join(' ')
          .trim();
        if (!text) continue;
        samples.push({ pageIndex: page.pageIndex, text: normalize(text), bbox: region.bbox });
      }
    }
  }

  // Fallback: IDM page headers/footers
  if (samples.length === 0) {
    for (const section of input.idm.sections) {
      for (const page of section.pages) {
        const zones = kind === 'header' ? page.headers : page.footers;
        for (const hf of zones) {
          const text = headerFooterText(hf.blocks);
          if (!text) continue;
          const bbox = hf.blocks[0]?.bbox;
          samples.push({
            pageIndex: page.index,
            text: normalize(text),
            bbox,
          });
        }
      }
    }
  }

  if (samples.length === 0) return [];

  // Cluster identical normalized text across pages
  const byText = new Map<string, typeof samples>();
  for (const s of samples) {
    let arr = byText.get(s.text);
    if (!arr) {
      arr = [];
      byText.set(s.text, arr);
    }
    arr.push(s);
  }

  const out: RunningRegion[] = [];
  for (const [text, group] of byText) {
    const pages = [...new Set(group.map((g) => g.pageIndex))].sort((a, b) => a - b);
    // Single-page "headers" only count if layout classified them
    if (pages.length < 2 && !(input.layout && group.length >= 1)) continue;
    if (pages.length === 1 && input.raw.pages.length > 1) {
      // Keep first-page-only headers with lower confidence
    }

    out.push({
      id: createId(kind === 'header' ? 'hdr' : 'ftr'),
      kind,
      variant: classifyVariant(text, kind, pages, input.raw.pages.length),
      text,
      pageIndices: pages,
      bboxSample: group[0]?.bbox,
      confidence: pages.length >= 2 ? 0.85 : 0.55,
    });
  }

  return out.sort((a, b) => b.confidence - a.confidence);
}

function classifyVariant(
  text: string,
  kind: 'header' | 'footer',
  pages: number[],
  pageCount: number,
): HeaderFooterVariant {
  if (/copyright|©/i.test(text)) return 'copyright';
  if (/confidential|internal use only/i.test(text)) return 'confidential';
  if (/rev(ision)?\.?\s*\d|v\d+\.\d+/i.test(text)) return 'revision';
  if (/version\s*\d/i.test(text)) return 'version';
  if (/inc\.|llc|ltd|corp/i.test(text) && kind === 'footer') return 'company';

  if (pages.length === 1 && pages[0] === 0) return 'first';
  if (pages.length >= 2 && pages.every((p) => p % 2 === 1)) return 'odd';
  if (pages.length >= 2 && pages.every((p) => p % 2 === 0)) return 'even';
  if (pages.length >= Math.max(2, Math.floor(pageCount * 0.5))) return 'running';
  return 'unknown';
}

function normalize(text: string): string {
  // Strip page numbers for clustering headers/footers
  return text
    .replace(/\b\d{1,4}\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function headerFooterText(blocks: unknown[]): string {
  return blocks
    .map((block) => {
      if (!block || typeof block !== 'object') return '';
      const b = block as { runs?: Array<{ text?: string }> };
      return (b.runs ?? []).map((r) => r.text ?? '').join('');
    })
    .join(' ')
    .trim();
}
