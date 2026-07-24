import type { UnifiedDocumentModel } from '../../../udm/types.js';

export function styleForType(type: string, level?: number): string | undefined {
  if (type === 'title') return 'Heading1';
  // Subtitles (job titles / companies) stay body text — Heading2 was too heavy
  if (type === 'subtitle') return undefined;
  if (type === 'heading') {
    const lvl = Math.min(6, Math.max(1, level ?? 1));
    return `Heading${lvl}`;
  }
  if (type === 'caption') return 'Caption';
  if (type === 'quote') return 'Quote';
  if (type === 'code_block') return 'Code';
  return undefined;
}

/** Map semantic alignment → OOXML w:jc (skip left/mixed — Word default is left). */
export function mapAlign(alignment?: string): string | undefined {
  if (!alignment || alignment === 'left' || alignment === 'mixed') return undefined;
  if (alignment === 'justify') return 'both';
  if (alignment === 'center' || alignment === 'right') return alignment;
  return undefined;
}

/** Prefer source PDF page size (A4 resumes are taller than US Letter). */
export function pageSizeTwips(udm: UnifiedDocumentModel): { w: number; h: number } {
  const page = udm.idm.sections[0]?.pages[0];
  const ptW = page?.width;
  const ptH = page?.height;
  if (ptW && ptH && ptW > 50 && ptH > 50) {
    return {
      w: Math.round(ptW * 20),
      h: Math.round(ptH * 20),
    };
  }
  // A4 default (better for international resumes than Letter)
  return { w: 11906, h: 16838 };
}

/** Right tab flush with content edge (page width − left/right margins). */
export function contentRightTabTwips(udm: UnifiedDocumentModel): number {
  const { w } = pageSizeTwips(udm);
  const margin = 720;
  return Math.max(3600, w - margin * 2);
}

/** Convert PDF points → OOXML twips (1pt = 20 twips), clamped. */
export function twipsFromPts(
  pts: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (pts == null || !Number.isFinite(pts) || pts <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.round(pts * 20)));
}
