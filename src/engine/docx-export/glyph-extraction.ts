import type { PDFPageInfo, PDFObject } from '../types';
import * as Engine from '../index';
import type { PositionedGlyph } from './types';

export function ptTwips(pt: number): number {
  return Math.max(1, Math.round(pt * 20));
}

export function rgbToHex(rgb: [number, number, number] | null | undefined): string {
  if (!rgb) return '000000';
  const h = (v: number) =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `${h(rgb[0])}${h(rgb[1])}${h(rgb[2])}`.toUpperCase();
}

function stripSubset(name: string): string {
  return name.replace(/^[A-Z]{6}\+/, '');
}

function styleFlags(fontName: string, fontData?: Engine.FontData | null): { bold: boolean; italic: boolean } {
  if (fontData?.standardMetrics) {
    return {
      bold: fontData.standardMetrics.isBold,
      italic: fontData.standardMetrics.isItalic,
    };
  }
  const lower = stripSubset(fontData?.baseFont || fontName).toLowerCase();
  return {
    bold: /bold|black|heavy|extrabold|demibold|semibold/.test(lower),
    italic: /italic|oblique|slanted/.test(lower),
  };
}

export function mapPdfFontToWord(fontName: string, fontData?: Engine.FontData | null): string {
  const base = stripSubset(fontData?.baseFont || fontName);
  const n = base.toLowerCase();
  if (n.includes('helvetica') || n.includes('arial')) return 'Arial';
  if (n.includes('times')) return 'Times New Roman';
  if (n.includes('courier')) return 'Courier New';
  if (n.includes('garamond')) return 'Garamond';
  if (n.includes('georgia')) return 'Georgia';
  if (n.includes('verdana')) return 'Verdana';
  if (n.includes('tahoma')) return 'Tahoma';
  if (n.includes('calibri')) return 'Calibri';
  if (n.includes('cambria')) return 'Cambria';
  if (n.includes('trebuchet')) return 'Trebuchet MS';
  const cleaned = base
    .replace(/[-_]?(Bold|Italic|Oblique|Regular|Medium|Light|Black|Heavy|SemiBold|DemiBold).*$/i, '')
    .replace(/MT$/i, '')
    .trim();
  return cleaned || 'Calibri';
}

function sanitizeText(text: string): string {
  return [...text]
    .map(ch => {
      const code = ch.codePointAt(0) ?? 0;
      if (code < 0x09) return '';
      if (code === 0x09 || code === 0x0a || code === 0x0d) return ' ';
      if (code < 0x20) return '';
      if (code === 0xfffd || code === 0xfffc) return '';
      return ch;
    })
    .join('');
}

export interface ExtractedPageData {
  glyphs: PositionedGlyph[];
  rawTextRuns: Engine.TextRun[];
  displayList: Engine.DisplayItem[];
  pageWidth: number;
  pageHeight: number;
  fonts: Map<string, Engine.FontData>;
}

export function extractGlyphs(
  page: PDFPageInfo,
  objects: Map<string, PDFObject>
): ExtractedPageData {
  const contentBytes = Engine.getPageContentBytes(page, objects);
  const interpreted = Engine.interpretPage(contentBytes, page, objects);
  const fonts = Engine.loadPageFonts(page.resources, objects);

  const glyphs: PositionedGlyph[] = [];

  for (const run of interpreted.textRuns) {
    const fontData = fonts.get(run.fontName) ?? null;
    const flags = styleFlags(run.fontName, fontData);
    const color = rgbToHex(run.fillColor);
    const fontFamily = mapPdfFontToWord(run.fontName, fontData);

    for (const g of run.glyphs) {
      const char = sanitizeText(g.unicode);
      if (!char) continue;
      
      glyphs.push({
        text: char,
        x: g.x,
        y: g.y,
        width: g.width,
        height: g.fontSize, // use fontSize as rough height
        fontFamily,
        fontSize: g.fontSize,
        bold: flags.bold,
        italic: flags.italic,
        color
      });
    }
  }

  return { 
    glyphs, 
    rawTextRuns: interpreted.textRuns, 
    displayList: interpreted.displayList,
    pageWidth: page.mediaBox.width,
    pageHeight: page.mediaBox.height,
    fonts
  };
}
