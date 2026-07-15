/** XML helpers for OOXML generation. */

export function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function w(tag: string, attrs: Record<string, string | number | undefined> = {}, body = ''): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== undefined && v !== '')
    .map(([k, v]) => ` ${k}="${esc(String(v))}"`)
    .join('');
  if (!body) return `<w:${tag}${a}/>`;
  return `<w:${tag}${a}>${body}</w:${tag}>`;
}

export function runText(text: string, opts: {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontSizePt?: number;
  fontName?: string;
  color?: string;
  vertAlign?: 'superscript' | 'subscript';
} = {}): string {
  const rPrParts: string[] = [];
  if (opts.bold) rPrParts.push('<w:b/>');
  if (opts.italic) rPrParts.push('<w:i/>');
  if (opts.underline) rPrParts.push('<w:u w:val="single"/>');
  if (opts.strike) rPrParts.push('<w:strike/>');
  if (opts.fontSizePt) {
    const half = Math.round(opts.fontSizePt * 2);
    rPrParts.push(`<w:sz w:val="${half}"/><w:szCs w:val="${half}"/>`);
  }
  if (opts.fontName) {
    rPrParts.push(
      `<w:rFonts w:ascii="${esc(opts.fontName)}" w:hAnsi="${esc(opts.fontName)}" w:cs="${esc(opts.fontName)}"/>`,
    );
  }
  if (opts.color) rPrParts.push(`<w:color w:val="${esc(opts.color.replace('#', ''))}"/>`);
  if (opts.vertAlign) rPrParts.push(`<w:vertAlign w:val="${opts.vertAlign}"/>`);

  const rPr = rPrParts.length ? `<w:rPr>${rPrParts.join('')}</w:rPr>` : '';
  // Preserve spaces
  const xmlSpace = /^\s|\s$/.test(text) || text.includes('  ') ? ' xml:space="preserve"' : '';
  return `<w:r>${rPr}<w:t${xmlSpace}>${esc(text)}</w:t></w:r>`;
}

export function paragraph(
  runsXml: string,
  opts: {
    style?: string;
    align?: string;
    spacingBefore?: number;
    spacingAfter?: number;
    line?: number;
    keepNext?: boolean;
    pageBreakBefore?: boolean;
  } = {},
): string {
  const pPr: string[] = [];
  if (opts.style) pPr.push(`<w:pStyle w:val="${esc(opts.style)}"/>`);
  if (opts.align) pPr.push(`<w:jc w:val="${esc(opts.align)}"/>`);
  if (opts.keepNext) pPr.push('<w:keepNext/>');
  if (opts.pageBreakBefore) pPr.push('<w:pageBreakBefore/>');
  const spacing: string[] = [];
  if (opts.spacingBefore != null) spacing.push(`w:before="${opts.spacingBefore}"`);
  if (opts.spacingAfter != null) spacing.push(`w:after="${opts.spacingAfter}"`);
  if (opts.line != null) spacing.push(`w:line="${opts.line}" w:lineRule="auto"`);
  if (spacing.length) pPr.push(`<w:spacing ${spacing.join(' ')}/>`);
  const pPrXml = pPr.length ? `<w:pPr>${pPr.join('')}</w:pPr>` : '';
  return `<w:p>${pPrXml}${runsXml}</w:p>`;
}
