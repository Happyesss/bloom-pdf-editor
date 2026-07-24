import type { UnifiedDocumentModel } from '../../../udm/types.js';
import { esc, paragraph, runText } from '../ooxml/xml.js';
import { looksLikeContactLine } from '../utils/heuristics.js';
import { pageSizeTwips } from '../utils/layout.js';

export function buildSectPr(udm: UnifiedDocumentModel, hasHeader: boolean, hasFooter: boolean): string {
  const parts: string[] = [];
  if (hasHeader) parts.push('<w:headerReference w:type="default" r:id="rIdHeader"/>');
  if (hasFooter) parts.push('<w:footerReference w:type="default" r:id="rIdFooter"/>');
  // titlePg implies a distinct first-page header; never emit it without a real header part
  // (Pages refuses documents with orphan titlePg).
  const first =
    hasHeader && !!udm.structure?.headers.some((h) => h.variant === 'first');
  if (first) parts.push('<w:titlePg/>');
  const { w, h } = pageSizeTwips(udm);
  // Tight margins (~0.5") match dense resumes; PDF content often starts ~25–36pt in.
  parts.push(`<w:pgSz w:w="${w}" w:h="${h}"/>`);
  parts.push(
    '<w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360"/>',
  );
  return `<w:sectPr>${parts.join('')}</w:sectPr>`;
}

export function buildHeader(udm: UnifiedDocumentModel): string | null {
  const h = udm.structure?.headers[0];
  if (!h) return null;
  const text = h.text.replace(/#/g, '').trim() || h.text;
  // Contact/name bands are now also in the body — avoid duplicating them in Word header.
  if (looksLikeContactLine(text)) return null;
  const bodyDup = Object.values(udm.semantic.nodes).some(
    (n) => 'text' in n && typeof n.text === 'string' && n.text.trim() && text && n.text.includes(text.slice(0, Math.min(24, text.length))),
  );
  if (bodyDup) return null;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  ${paragraph(runText(text), { align: 'center' })}
</w:hdr>`;
}

/** Full-width horizontal rule via a 1-cell table (Pages-safe; pBdr is often ignored). */
export function horizontalRule(colorHex: string, widthTwips: number, sz = 12): string {
  const color = colorHex.replace('#', '');
  const w = Math.max(1440, Math.round(widthTwips));
  // Marker: w:line="20" w:lineRule="exact" — empty 1-cell rule table (no custom tblStyle)
  return `<w:tbl>
  <w:tblPr>
    <w:tblW w:w="${w}" w:type="dxa"/>
    <w:tblBorders>
      <w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="nil"/><w:right w:val="nil"/>
      <w:insideH w:val="nil"/><w:insideV w:val="nil"/>
    </w:tblBorders>
    <w:tblCellMar>
      <w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/>
      <w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/>
    </w:tblCellMar>
  </w:tblPr>
  <w:tblGrid><w:gridCol w:w="${w}"/></w:tblGrid>
  <w:tr>
    <w:tc>
      <w:tcPr>
        <w:tcW w:w="${w}" w:type="dxa"/>
        <w:tcBorders>
          <w:top w:val="nil"/><w:left w:val="nil"/>
          <w:bottom w:val="single" w:sz="${sz}" w:space="0" w:color="${esc(color)}"/>
          <w:right w:val="nil"/>
        </w:tcBorders>
      </w:tcPr>
      <w:p><w:pPr><w:spacing w:before="0" w:after="20" w:line="20" w:lineRule="exact"/></w:pPr></w:p>
    </w:tc>
  </w:tr>
</w:tbl>`;
}

export function buildFooter(udm: UnifiedDocumentModel): string | null {
  const f = udm.structure?.footers[0];
  const hasPageNums = (udm.structure?.pageNumbers.length ?? 0) > 0;
  if (!f && !hasPageNums) return null;
  const text = f ? f.text.replace(/#/g, '').trim() : '';
  const pageNum = hasPageNums
    ? `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
    : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:p>
    <w:pPr><w:jc w:val="center"/></w:pPr>
    ${text ? runText(text + ' ') : ''}${pageNum}
  </w:p>
</w:ftr>`;
}

export function buildFootnotes(udm: UnifiedDocumentModel): string | null {
  const notes = udm.structure?.footnotes ?? [];
  if (!notes.length) return null;
  const parts = notes.map((n, i) => {
    const id = i + 1;
    return `<w:footnote w:id="${id}">
      <w:p>${runText(n.marker + ' ' + n.body)}</w:p>
    </w:footnote>`;
  });
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>
  <w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>
  ${parts.join('\n')}
</w:footnotes>`;
}
