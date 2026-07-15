import type { LogicalTable } from '../../table/types.js';
import type { UnifiedDocumentModel } from '../../udm/types.js';
import { esc, paragraph, runText } from './xml.js';

export interface DocumentWriteResult {
  documentXml: string;
  headerXml: string | null;
  footerXml: string | null;
  footnotesXml: string | null;
  rels: Array<{ id: string; type: string; target: string; targetMode?: string }>;
  media: Array<{ name: string; data: Uint8Array; contentType: string }>;
}

/** Map UDM → word/document.xml body (no PDF access). */
export function writeDocument(udm: UnifiedDocumentModel): DocumentWriteResult {
  const body: string[] = [];
  const rels: DocumentWriteResult['rels'] = [];
  const media: DocumentWriteResult['media'] = [];
  let relSeq = 1;
  const nextRid = () => `rId${relSeq++}`;

  const tableById = new Map(udm.tables.map((t) => [t.id, t]));
  const emittedTables = new Set<string>();

  // Bookmarks from structure
  const bookmarks = udm.structure?.bookmarks ?? [];
  let bookmarkId = 0;

  for (const nodeId of udm.semantic.readingOrder) {
    const node = udm.semantic.nodes[nodeId];
    if (!node) continue;

    if (node.type === 'table') {
      const logicalId = 'logicalTableId' in node ? String(node.logicalTableId) : '';
      const table = tableById.get(logicalId);
      if (table && !emittedTables.has(table.id)) {
        body.push(writeTable(table));
        emittedTables.add(table.id);
      }
      continue;
    }

    if (node.type === 'image') {
      // Images without bytes become placeholder paragraphs (no PDF fetch)
      const alt = 'alt' in node ? String(node.alt ?? 'Image') : 'Image';
      body.push(paragraph(runText(`[Image: ${alt}]`, { italic: true }), { style: 'Caption' }));
      continue;
    }

    if (node.type === 'list') {
      const items = node.childIds
        .map((id) => udm.semantic.nodes[id])
        .filter((n) => n && n.type === 'list_item');
      const numbered =
        'listStyle' in node &&
        (node.listStyle === 'numbered' ||
          node.listStyle === 'alphabetic' ||
          node.listStyle === 'roman');
      const numId =
        'listStyle' in node && node.listStyle === 'roman'
          ? 3
          : numbered
            ? 2
            : 1;
      for (const item of items) {
        if (!item || !('text' in item)) continue;
        const text = String(item.text ?? '');
        body.push(
          `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>${runText(text)}</w:p>`,
        );
      }
      continue;
    }

    if (node.type === 'list_item') continue; // emitted with list

    if (!('text' in node) || node.text == null) continue;
    const text = String(node.text);
    if (!text.trim() && node.type !== 'paragraph') continue;

    const style = styleForType(node.type, 'level' in node ? Number(node.level) : undefined);
    const runs = runsFromNode(node);

    // Hyperlink wrapper
    if (node.type === 'hyperlink' && 'uri' in node && node.uri) {
      const rid = nextRid();
      rels.push({
        id: rid,
        type: 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink',
        target: String(node.uri),
        targetMode: 'External',
      });
      body.push(
        paragraph(
          `<w:hyperlink r:id="${rid}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">${runs}</w:hyperlink>`,
          { style },
        ),
      );
      continue;
    }

    // Heading bookmarks
    if ((node.type === 'heading' || node.type === 'title') && bookmarks.length) {
      const bm = bookmarks.find((b) => b.title === text);
      if (bm) {
        const id = bookmarkId++;
        body.push(
          paragraph(
            `<w:bookmarkStart w:id="${id}" w:name="${esc(bm.title.slice(0, 40))}"/>${runs}<w:bookmarkEnd w:id="${id}"/>`,
            { style, keepNext: true },
          ),
        );
        continue;
      }
    }

    body.push(paragraph(runs, { style }));
  }

  // Remaining tables not in reading order
  for (const t of udm.tables) {
    if (!emittedTables.has(t.id)) body.push(writeTable(t));
  }

  if (body.length === 0) {
    body.push(paragraph(runText(udm.metadata.title ?? 'Document')));
  }

  const sectPr = buildSectPr(udm, !!udm.structure?.headers.length, !!udm.structure?.footers.length);

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${body.join('\n')}
    ${sectPr}
  </w:body>
</w:document>`;

  const headerXml = buildHeader(udm);
  const footerXml = buildFooter(udm);
  const footnotesXml = buildFootnotes(udm);

  void media;
  return { documentXml, headerXml, footerXml, footnotesXml, rels, media };
}

function styleForType(type: string, level?: number): string | undefined {
  if (type === 'title') return 'Heading1';
  if (type === 'subtitle') return 'Heading2';
  if (type === 'heading') {
    const lvl = Math.min(6, Math.max(1, level ?? 1));
    return `Heading${lvl}`;
  }
  if (type === 'caption') return 'Caption';
  if (type === 'quote') return 'Quote';
  if (type === 'code_block') return 'Code';
  return undefined;
}

function runsFromNode(node: {
  type: string;
  text?: string;
  runs?: Array<{
    text: string;
    bold?: boolean;
    italic?: boolean;
    underline?: boolean;
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
          fontName: r.fontName,
          fontSizePt: r.fontSize,
          color: r.color,
        }),
      )
      .join('');
  }
  return runText(String(node.text ?? ''), {
    bold: node.type === 'heading' || node.type === 'title',
    italic: node.type === 'quote',
  });
}

function writeTable(table: LogicalTable): string {
  const colCount = table.columns.length;
  const grid = table.columns
    .map((c) => {
      const twips = Math.max(400, Math.round((c.width || 100) * 15));
      return `<w:gridCol w:w="${twips}"/>`;
    })
    .join('');

  // Build occupancy grid for spans
  const occupied = new Set<string>();
  const rowsXml: string[] = [];

  for (let r = 0; r < table.rows.length; r++) {
    const row = table.rows[r]!;
    const cells = table.cells
      .filter((c) => c.rowIndex === r)
      .sort((a, b) => a.colIndex - b.colIndex);

    const tcs: string[] = [];
    for (let c = 0; c < colCount; c++) {
      if (occupied.has(`${r},${c}`)) continue;
      const cell = cells.find((x) => x.colIndex === c);
      if (!cell) {
        tcs.push('<w:tc><w:tcPr/><w:p/></w:tc>');
        continue;
      }
      for (let rr = 0; rr < cell.rowSpan; rr++) {
        for (let cc = 0; cc < cell.colSpan; cc++) {
          if (rr || cc) occupied.add(`${r + rr},${c + cc}`);
        }
      }
      const tcPr: string[] = [];
      if (cell.colSpan > 1) tcPr.push(`<w:gridSpan w:val="${cell.colSpan}"/>`);
      if (cell.rowSpan > 1) tcPr.push('<w:vMerge w:val="restart"/>');
      const width = Math.round(
        table.columns
          .slice(c, c + cell.colSpan)
          .reduce((s, col) => s + (col.width || 100), 0) * 15,
      );
      tcPr.push(`<w:tcW w:w="${width}" w:type="dxa"/>`);
      tcs.push(
        `<w:tc><w:tcPr>${tcPr.join('')}</w:tcPr>${paragraph(runText(cell.text || ' '))}</w:tc>`,
      );
    }

    // Continue vMerge for spanned rows is handled via occupied skip + empty vMerge cells
    // Add continue markers for vertical merges starting above
    for (const cell of table.cells) {
      if (cell.rowSpan <= 1) continue;
      if (r > cell.rowIndex && r < cell.rowIndex + cell.rowSpan) {
        // already occupied — ensure we emitted vMerge continue; simplified: skip
      }
    }

    const trPr =
      row.role === 'header'
        ? '<w:trPr><w:tblHeader/></w:trPr>'
        : '';
    rowsXml.push(`<w:tr>${trPr}${tcs.join('')}</w:tr>`);
  }

  void colCount;
  return `<w:tbl>
  <w:tblPr>
    <w:tblW w:w="0" w:type="auto"/>
    <w:tblBorders>
      <w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>
      <w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>
      <w:bottom w:val="single" w:sz="4" w:space="0" w:color="000000"/>
      <w:right w:val="single" w:sz="4" w:space="0" w:color="000000"/>
      <w:insideH w:val="single" w:sz="4" w:space="0" w:color="000000"/>
      <w:insideV w:val="single" w:sz="4" w:space="0" w:color="000000"/>
    </w:tblBorders>
  </w:tblPr>
  <w:tblGrid>${grid}</w:tblGrid>
  ${rowsXml.join('\n')}
</w:tbl>`;
}

function buildSectPr(udm: UnifiedDocumentModel, hasHeader: boolean, hasFooter: boolean): string {
  const parts: string[] = [];
  if (hasHeader) parts.push('<w:headerReference w:type="default" r:id="rIdHeader"/>');
  if (hasFooter) parts.push('<w:footerReference w:type="default" r:id="rIdFooter"/>');
  const first = udm.structure?.headers.some((h) => h.variant === 'first');
  if (first) parts.push('<w:titlePg/>');
  parts.push('<w:pgSz w:w="12240" w:h="15840"/>');
  parts.push('<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/>');
  return `<w:sectPr>${parts.join('')}</w:sectPr>`;
}

function buildHeader(udm: UnifiedDocumentModel): string | null {
  const h = udm.structure?.headers[0];
  if (!h) return null;
  const text = h.text.replace(/#/g, '').trim() || h.text;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  ${paragraph(runText(text), { align: 'center' })}
</w:hdr>`;
}

function buildFooter(udm: UnifiedDocumentModel): string | null {
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

function buildFootnotes(udm: UnifiedDocumentModel): string | null {
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
