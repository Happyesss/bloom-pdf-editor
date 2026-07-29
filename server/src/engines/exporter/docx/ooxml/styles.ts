/** word/styles.xml — Normal + Heading1–6 + Caption/Quote/Code.
 * Compact defaults so dense PDFs (resumes) don't balloon to extra pages.
 * When typography analysis is available, uses the PDF's actual primary font and sizes.
 */
import type { TypographyAnalysis } from '../../../typography/types.js';

export function buildStylesXml(typography?: TypographyAnalysis | null): string {
  // Resolve primary font and default size from PDF typography analysis
  const primaryFont = typography?.statistics?.primaryFonts?.[0]?.font ?? 'Calibri';
  const dominantSize = typography?.statistics?.dominantFontSizes?.[0]?.size;
  // Default body size in half-points (OOXML convention); fallback 18 = 9pt
  const defaultHalf = dominantSize ? Math.round(dominantSize * 2) : 18;
  // Heading sizes derived from default
  const h1Half = Math.max(defaultHalf + 10, Math.round(defaultHalf * 1.5));
  const h23Half = Math.max(defaultHalf + 6, Math.round(defaultHalf * 1.3));
  const h456Half = Math.max(defaultHalf + 4, Math.round(defaultHalf * 1.15));

  // Spacing from typography averages
  const avgLineHeight = typography?.statistics?.averages?.lineHeight;
  const lineSpacing = avgLineHeight && avgLineHeight > 0
    ? Math.min(400, Math.max(200, Math.round(avgLineHeight * 20)))
    : 240;
  const avgParaGap = typography?.statistics?.averages?.paragraphGap;
  const defaultAfter = avgParaGap && avgParaGap > 0
    ? Math.min(200, Math.max(20, Math.round(avgParaGap * 20)))
    : 40;

  // Sanitize font name for XML
  const escFont = (f: string) => f.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  const fontAscii = escFont(primaryFont);

  const headings = [1, 2, 3, 4, 5, 6]
    .map(
      (n) => `
  <w:style w:type="paragraph" w:styleId="Heading${n}">
    <w:name w:val="heading ${n}"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:qFormat/>
    <w:pPr>
      <w:keepNext/>
      <w:spacing w:before="${n === 1 ? 0 : 80}" w:after="20" w:line="${lineSpacing}" w:lineRule="auto"/>
      <w:outlineLvl w:val="${n - 1}"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="${n === 1 ? h1Half : n <= 3 ? h23Half : h456Half}"/>
      <w:szCs w:val="${n === 1 ? h1Half : n <= 3 ? h23Half : h456Half}"/>
    </w:rPr>
  </w:style>`,
    )
    .join('\n');

  // Caption size: slightly smaller than body
  const captionHalf = Math.max(12, defaultHalf - 2);
  const codeHalf = Math.max(12, defaultHalf - 2);

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="${fontAscii}" w:hAnsi="${fontAscii}" w:cs="${fontAscii}"/>
      <w:sz w:val="${defaultHalf}"/><w:szCs w:val="${defaultHalf}"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr>
      <w:spacing w:before="0" w:after="${defaultAfter}" w:line="${lineSpacing}" w:lineRule="auto"/>
    </w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/><w:qFormat/>
    <w:pPr>
      <w:spacing w:before="0" w:after="${defaultAfter}" w:line="${lineSpacing}" w:lineRule="auto"/>
    </w:pPr>
  </w:style>
  ${headings}
  <w:style w:type="paragraph" w:styleId="Caption">
    <w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:rPr><w:i/><w:sz w:val="${captionHalf}"/><w:szCs w:val="${captionHalf}"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:ind w:left="360"/><w:spacing w:before="40" w:after="40"/></w:pPr>
    <w:rPr><w:i/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Code">
    <w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="${codeHalf}"/><w:szCs w:val="${codeHalf}"/></w:rPr>
  </w:style>
</w:styles>`;
}
