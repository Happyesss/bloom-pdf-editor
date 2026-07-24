import type { UnifiedDocumentModel } from '../../../udm/types.js';

export function isNearBlack(color?: string): boolean {
  if (!color) return true;
  const hex = color.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return true;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return r < 40 && g < 40 && b < 40;
}

export function firstRunColor(node: { runs?: Array<{ color?: string }> }): string | undefined {
  return node.runs?.find((r) => r.color)?.color;
}

export function pickAccentColors(udm: UnifiedDocumentModel): {
  text: string;
  headerFill: string;
  border: string;
  muted: string;
  fromPdf: boolean;
} {
  // Neutral fallback — never invent a brand green when the PDF is black/gray-only.
  const fallback = {
    text: '#000000',
    headerFill: '#ffffff',
    border: '#000000',
    muted: '#666666',
  };
  const palette = udm.typography?.statistics?.colorPalette ?? [];
  // Prefer a dark non-gray chromatic color only when it actually appears in the PDF
  const accent = palette.find((p) => {
    const hex = p.color?.replace('#', '') ?? '';
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return false;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    return max - min > 25 && max < 200; // saturated-ish, not near-white
  })?.color;
  // Light fill near white with a chromatic tint (only if present in PDF)
  const fill = palette.find((p) => {
    const hex = p.color?.replace('#', '') ?? '';
    if (!/^[0-9a-fA-F]{6}$/.test(hex)) return false;
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    return r > 220 && g > 220 && b > 220 && (g > r || b > r);
  })?.color;
  return {
    text: accent ?? fallback.text,
    headerFill: fill ?? fallback.headerFill,
    border: accent ?? fallback.border,
    muted: fallback.muted,
    fromPdf: !!accent,
  };
}
