import { paragraph, runText } from '../ooxml/xml.js';

export function runsFromNode(node: {
  type: string;
  text?: string;
  runs?: Array<{
    text: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
    strike?: boolean;
    superscript?: boolean;
    subscript?: boolean;
    fontName?: string;
    fontSize?: number;
    color?: string;
  }>;
}): string {
  if (node.runs?.length) {
    return node.runs
      .map((r) =>
        runText(r.text, {
          bold: r.bold || node.type === 'heading' || node.type === 'title',
          italic: r.italic || node.type === 'quote',
          underline: r.underline,
          strike: r.strike,
          fontName: r.fontName,
          fontSizePt: r.fontSize,
          // Faithful replay: never invent theme colors for near-black text
          color: r.color,
          vertAlign: r.superscript ? 'superscript' : r.subscript ? 'subscript' : undefined,
        }),
      )
      .join('');
  }
  return runText(String(node.text ?? ''), {
    bold: node.type === 'heading' || node.type === 'title' || node.type === 'subtitle',
    italic: node.type === 'quote',
    color: undefined,
  });
}

export function listParagraph(runsXml: string, numId: number): string {
  return `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr><w:spacing w:before="0" w:after="20" w:line="240" w:lineRule="auto"/></w:pPr>${runsXml}</w:p>`;
}

export function compactCellParagraph(runsXml: string, align?: string): string {
  return paragraph(runsXml, { spacingBefore: 0, spacingAfter: 0, line: 240, align });
}

/** OOXML bookmark names must be [A-Za-z0-9_] (no spaces / punctuation). */
export function sanitizeBookmarkName(title: string): string {
  const cleaned = title
    .replace(/&/g, 'and')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (!cleaned) return '';
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `bm_${cleaned}`;
}
