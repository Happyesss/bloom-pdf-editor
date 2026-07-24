/** word/styles.xml — Normal + Heading1–6 + Caption/Quote/Code.
 * Compact defaults so dense PDFs (resumes) don't balloon to extra pages.
 */
export function buildStylesXml(): string {
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
      <w:spacing w:before="${n === 1 ? 0 : 80}" w:after="20" w:line="240" w:lineRule="auto"/>
      <w:outlineLvl w:val="${n - 1}"/>
    </w:pPr>
    <w:rPr>
      <w:b/>
      <w:sz w:val="${n === 1 ? 28 : n <= 3 ? 24 : 22}"/>
      <w:szCs w:val="${n === 1 ? 28 : n <= 3 ? 24 : 22}"/>
    </w:rPr>
  </w:style>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/>
      <w:sz w:val="18"/><w:szCs w:val="18"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr>
      <w:spacing w:before="0" w:after="40" w:line="240" w:lineRule="auto"/>
    </w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/><w:qFormat/>
    <w:pPr>
      <w:spacing w:before="0" w:after="40" w:line="240" w:lineRule="auto"/>
    </w:pPr>
  </w:style>
  ${headings}
  <w:style w:type="paragraph" w:styleId="Caption">
    <w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:rPr><w:i/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Quote">
    <w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:pPr><w:ind w:left="360"/><w:spacing w:before="40" w:after="40"/></w:pPr>
    <w:rPr><w:i/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Code">
    <w:name w:val="Code"/><w:basedOn w:val="Normal"/><w:qFormat/>
    <w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="16"/><w:szCs w:val="16"/></w:rPr>
  </w:style>
</w:styles>`;
}
