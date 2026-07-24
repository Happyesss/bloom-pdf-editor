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
  let relSeq = 10;
  const nextRid = () => `rId${relSeq++}`;

  const tableById = new Map(udm.tables.map((t) => [t.id, t]));
  const emittedTables = new Set<string>();

  // Bookmarks from structure
  const bookmarks = udm.structure?.bookmarks ?? [];
  let bookmarkId = 0;

  const accent = pickAccentColors(udm);
  const contentRightTwips = contentRightTabTwips(udm);
  // Full-width table HRs — Pages often ignores w:pBdr; table borders render reliably.
  const sectionRuleColor = (accent.border || accent.text).replace(/^#/, '');

  const order = udm.semantic.readingOrder;
  for (let oi = 0; oi < order.length; oi++) {
    const nodeId = order[oi]!;
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
        // Use runsFromNode to preserve bold/italic/color formatting within list items
        const itemRuns = 'runs' in item && (item as any).runs?.length
          ? runsFromNode(item as any)
          : runText(text);
        body.push(listParagraph(itemRuns, numId));
      }
      continue;
    }

    if (node.type === 'list_item') continue; // emitted with list

    if (!('text' in node) || node.text == null) continue;
    const text = String(node.text);
    // Drop empty placeholder paragraphs
    if (!text.trim()) continue;

    // Flattened education header + rows → real Word table
    if (node.type === 'paragraph' && isEducationHeaderRow(text)) {
      const rowTexts: string[] = [];
      let look = oi + 1;
      while (look < order.length) {
        const n2 = udm.semantic.nodes[order[look]!];
        if (!n2 || !('text' in n2)) break;
        if (n2.type !== 'paragraph' && n2.type !== 'subtitle') break;
        const t2 = String(n2.text ?? '').trim();
        if (!t2 || isEducationHeaderRow(t2)) break;
        // Soft-wrapped header fragment like "Remarks" / "Board" — skip
        if (/^(Remarks|Board)\b/i.test(t2) && t2.length < 24) {
          look++;
          continue;
        }
        if (!looksLikeEducationDataRow(t2)) break;
        rowTexts.push(t2);
        look++;
      }
      if (rowTexts.length >= 2) {
        body.push(writeEducationTable(rowTexts, accent));
        oi = look - 1;
        continue;
      }
    }

    const style = styleForType(node.type, 'level' in node ? Number(node.level) : undefined);
    const nodeColor = firstRunColor(node as { runs?: Array<{ color?: string }> });
    let runs = runsFromNode(node, accent.text);
    // Label-only lines ("Personal Achievements:") → bold body text
    if (/^[A-Z][^:\n]{1,40}:\s*$/.test(text.trim())) {
      runs = runText(text.trim(), { bold: true, color: nodeColor });
    }
    // "Extra-Curricular Activities: Hosted… • Represented…" → label + item 0 inline, items 1+ as bullets
    const extra = splitLabelWithInlineBullets(text);
    if (extra) {
      const firstItem = extra.items[0] ?? '';
      // Section labels (Technical Skills:, Personal Achievements:, Extra-Curricular Activities:) are always green
      const labelRun = runText(extra.label + ' ', { bold: true, color: accent.text });
      const firstRun = runText(firstItem, { color: nodeColor });
      body.push(
        paragraph(labelRun + firstRun, {
          spacingBefore: 60,
          spacingAfter: 20,
          line: 240,
        }),
      );
      for (let ii = 1; ii < extra.items.length; ii++) {
        body.push(listParagraph(runText(extra.items[ii]!, { color: nodeColor }), 1));
      }
      continue;
    }
    let align = mapAlign('alignment' in node ? (node as { alignment?: string }).alignment : undefined);
    // Name/title lines are centered on resumes even when alignment is missing
    if (!align && node.type === 'title') align = 'center';
    // Only name + contact stay centered; section/job lines are left
    if (align === 'center' && node.type !== 'title' && !looksLikeContactLine(text)) {
      align = undefined;
    }

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
          { style, align },
        ),
      );
      continue;
    }

    // ALL-CAPS section titles misclassified as subtitle → still emit as heading
    if (isSectionTitleLine(text) && (node.type === 'subtitle' || node.type === 'paragraph')) {
      body.push(
        paragraph(runsFromNode({ ...node, type: 'heading' }, accent.text), {
          style: 'Heading3',
          align,
          keepNext: true,
          spacingBefore: 120,
          spacingAfter: 40,
          line: 240,
          bottomBorder: { color: sectionRuleColor, sz: 12, space: 1 },
        }),
      );
      continue;
    }

    // Heading bookmarks — Word/Pages bookmark names: letter/digit/underscore only
    if ((node.type === 'heading' || node.type === 'title') && bookmarks.length) {
      const bm = bookmarks.find((b) => b.title === text);
      if (bm) {
        const id = bookmarkId++;
        const bmName = sanitizeBookmarkName(bm.title) || `bm_${id}`;
        body.push(
          paragraph(
            `<w:bookmarkStart w:id="${id}" w:name="${esc(bmName)}"/>${runs}<w:bookmarkEnd w:id="${id}"/>`,
            {
              style,
              align,
              keepNext: true,
              spacingBefore: node.type === 'title' ? 0 : 120,
              spacingAfter: node.type === 'heading' ? 40 : 40,
              line: 240,
              bottomBorder: node.type === 'heading'
                ? { color: sectionRuleColor, sz: 12, space: 1 }
                : undefined,
            },
          ),
        );
        continue;
      }
    }

    // Resume job lines: "Assistant Manager Nov 2025 - Apr 2026" → title left, date right
    const split = splitTitleAndDate(text);
    if (split && (node.type === 'paragraph' || node.type === 'subtitle' || node.type === 'heading')) {
      const titleColor =
        nodeColor && !isNearBlack(nodeColor) ? nodeColor : accent.text;
      const titleRun = runText(split.title, {
        bold: node.type === 'heading' || node.type === 'subtitle',
        color: titleColor,
      });
      const dateRun = runText(split.date, { italic: true, color: accent.muted });
      body.push(
        paragraph(`${titleRun}<w:r><w:tab/></w:r>${dateRun}`, {
          rightTabPos: contentRightTwips,
          spacingBefore: 80,
          spacingAfter: 0,
          line: 240,
        }),
      );
      continue;
    }

    // Company lines under job titles → green italic (never ALL-CAPS section titles)
    if (
      node.type === 'subtitle' &&
      !splitTitleAndDate(text) &&
      !isSectionTitleLine(text) &&
      text.trim().split(/\s+/).length <= 6
    ) {
      body.push(
        paragraph(runText(text.trim(), { italic: true, bold: false, color: accent.text }), {
          spacingBefore: 0,
          spacingAfter: 20,
          line: 240,
        }),
      );
      continue;
    }

    // Compact spacing: section headings slightly more gap before; body stays tight
    const isHeadingLike =
      node.type === 'heading' ||
      node.type === 'title' ||
      (style != null && style.startsWith('Heading'));
    const isContact = looksLikeContactLine(text);
    const needsRule = node.type === 'heading' || isContact;
    body.push(
      paragraph(runs, {
        style,
        align,
        spacingBefore: node.type === 'title' ? 0 : isHeadingLike ? 120 : 0,
        spacingAfter: needsRule ? 40 : node.type === 'title' ? 40 : isHeadingLike ? 40 : 40,
        line: 240,
        keepNext: isHeadingLike || isContact ? true : undefined,
        bottomBorder: node.type === 'heading'
          ? { color: sectionRuleColor, sz: 12, space: 1 }
          : undefined,
      }),
    );
    if (isContact) {
      body.push(
        horizontalRule(
          sectionRuleColor,
          contentRightTwips,
          12,
        ),
      );
    }
  }

  // Remaining tables not in reading order
  for (const t of udm.tables) {
    if (!emittedTables.has(t.id)) body.push(writeTable(t));
  }

  if (body.length === 0) {
    body.push(paragraph(runText(udm.metadata.title ?? 'Document')));
  }

  // Build header/footer parts first — sectPr must only reference parts that actually exist.
  // Contact-like headers are intentionally omitted from the Word header (moved into body);
  // referencing a missing rIdHeader makes Word refuse to open the file.
  const headerXml = buildHeader(udm);
  const footerXml = buildFooter(udm);
  const footnotesXml = buildFootnotes(udm);
  const sectPr = buildSectPr(udm, !!headerXml, !!footerXml);

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:body>
    ${body.join('\n')}
    ${sectPr}
  </w:body>
</w:document>`;

  void media;
  return { documentXml, headerXml, footerXml, footnotesXml, rels, media };
}

function styleForType(type: string, level?: number): string | undefined {
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
function mapAlign(alignment?: string): string | undefined {
  if (!alignment || alignment === 'left' || alignment === 'mixed') return undefined;
  if (alignment === 'justify') return 'both';
  if (alignment === 'center' || alignment === 'right') return alignment;
  return undefined;
}

const JOB_DATE_RE =
  /\s+((?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{4}\s*[-–—]\s*(?:Present|(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{4}))\s*$/i;

function splitTitleAndDate(text: string): { title: string; date: string } | null {
  const m = text.match(JOB_DATE_RE);
  if (!m || m.index == null) return null;
  const title = text.slice(0, m.index).trim();
  const date = m[1]!.trim();
  if (title.length < 3 || date.length < 8) return null;
  return { title, date };
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
}, accentText?: string): string {
  const forceAccent =
    !!accentText &&
    (node.type === 'heading' || node.type === 'title' || node.type === 'subtitle') &&
    isNearBlack(node.runs?.find((r) => r.color)?.color);
  if (node.runs?.length) {
    return node.runs
      .map((r) =>
        runText(r.text, {
          bold: r.bold || node.type === 'heading' || node.type === 'title',
          italic: r.italic || node.type === 'quote',
          underline: r.underline,
          fontName: r.fontName,
          fontSizePt: r.fontSize,
          color: (forceAccent || node.type === 'subtitle') && (!r.color || isNearBlack(r.color)) ? accentText : r.color,
        }),
      )
      .join('');
  }
  return runText(String(node.text ?? ''), {
    bold: node.type === 'heading' || node.type === 'title' || node.type === 'subtitle',
    italic: node.type === 'quote',
    color: forceAccent ? accentText : undefined,
  });
}

function isNearBlack(color?: string): boolean {
  if (!color) return true;
  const hex = color.replace('#', '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return true;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return r < 40 && g < 40 && b < 40;
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

/** Prefer source PDF page size (A4 resumes are taller than US Letter). */
function pageSizeTwips(udm: UnifiedDocumentModel): { w: number; h: number } {
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
function contentRightTabTwips(udm: UnifiedDocumentModel): number {
  const { w } = pageSizeTwips(udm);
  const margin = 720;
  return Math.max(3600, w - margin * 2);
}

function listParagraph(runsXml: string, numId: number): string {
  return `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr><w:spacing w:before="0" w:after="20" w:line="240" w:lineRule="auto"/></w:pPr>${runsXml}</w:p>`;
}

function compactCellParagraph(runsXml: string): string {
  return paragraph(runsXml, { spacingBefore: 0, spacingAfter: 0, line: 240 });
}

/** OOXML bookmark names must be [A-Za-z0-9_] (no spaces / punctuation). */
function sanitizeBookmarkName(title: string): string {
  const cleaned = title
    .replace(/&/g, 'and')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
  if (!cleaned) return '';
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `bm_${cleaned}`;
}

function buildHeader(udm: UnifiedDocumentModel): string | null {
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

function looksLikeContactLine(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/@/.test(t) && /\|/.test(t)) return true;
  if (/\+?\d[\d\s-]{8,}\d/.test(t) && /@/.test(t)) return true;
  if (/linkedin\.com/i.test(t)) return true;
  return false;
}

/** "Extra-Curricular Activities: Hosted … • Represented …" */
function splitLabelWithInlineBullets(text: string): { label: string; items: string[] } | null {
  const m = text.trim().match(/^([A-Z][^:\n]{1,40}:)\s*(.+)$/);
  if (!m) return null;
  const label = m[1]!.trim();
  const rest = m[2]!.trim();
  if (!/Extra-Curricular|Activities|Personal Achievements|Achievements|Technical Skills|Skills|Competencies/i.test(label)) return null;
  if (!/[•·]/.test(rest) && !/\.\s+[A-Z]/.test(rest)) {
    // Single prose blob after label — still split label / body as one item
    if (rest.length < 20) return null;
    return { label, items: [rest] };
  }
  const items = rest
    .split(/\s*[•·]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  // Also split on ". Capital" if no bullets
  if (items.length <= 1 && /\.\s+[A-Z]/.test(rest)) {
    const parts = rest.split(/(?<=\.)\s+(?=[A-Z])/).map((s) => s.trim()).filter(Boolean);
    if (parts.length >= 2) return { label, items: parts };
  }
  if (items.length < 1) return null;
  return { label, items };
}

function isEducationHeaderRow(text: string): boolean {
  const t = text.trim();
  // Soft-wrap may cut "Remarks" onto the next line — Institution/ is enough.
  return (
    /\bCourse\b/i.test(t) &&
    /\bYear\b/i.test(t) &&
    /\b(Institution|Board|Remarks)\b/i.test(t)
  );
}

function isSectionTitleLine(text: string): boolean {
  const t = text.trim();
  if (t.length < 8 || t.length > 48) return false;
  if (!/[A-Z]{3,}/.test(t)) return false;
  // Mostly uppercase words (allow & / -)
  const letters = t.replace(/[^A-Za-z]/g, '');
  if (letters.length < 6) return false;
  const upper = letters.replace(/[^A-Z]/g, '').length;
  return upper / letters.length >= 0.85;
}

function firstRunColor(node: { runs?: Array<{ color?: string }> }): string | undefined {
  return node.runs?.find((r) => r.color)?.color;
}

function pickAccentColors(udm: UnifiedDocumentModel): {
  text: string;
  headerFill: string;
  border: string;
  muted: string;
} {
  const fallback = {
    text: '#1a472a',
    headerFill: '#f0f9f0',
    border: '#4a7c59',
    muted: '#666666',
  };
  const palette = udm.typography?.statistics?.colorPalette ?? [];
  // Prefer a dark non-gray chromatic color for headings
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
  // Light fill near white with a green/blue tint
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
  };
}

function looksLikeEducationDataRow(text: string): boolean {
  const t = text.trim();
  if (t.length < 12 || t.length > 220) return false;
  if (/PROFESSIONAL|COMPETENC|EDUCATION/i.test(t) && t === t.toUpperCase()) return false;
  return /^(CA\b|B\.?Com|Class\s+[XIV\d]|Bachelor|Master|MBA|Diploma)/i.test(t);
}

function parseEducationRow(text: string): [string, string, string, string] {
  const t = text.trim();
  const yearRe =
    /((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}|\d{4}\s*[-–]\s*\d{4}|March\s+\d{4})/i;
  const ym = t.match(yearRe);
  if (!ym || ym.index == null) return [t, '', '', ''];
  const course = t.slice(0, ym.index).trim();
  const year = ym[1]!;
  const rest = t.slice(ym.index + year.length).trim();
  if (!course || !rest) return [course || t, year, rest, ''];

  // "Delhi University Distinction…"
  const uni = rest.match(/^(.+?\bUniversity)\s+(.+)$/i);
  if (uni) return [course, year, uni[1]!.trim(), uni[2]!.trim()];

  // ICAI / CBSE / ICSE + remarks
  const board = rest.match(/^(ICAI|CBSE|ICSE)\s+(.+)$/i);
  if (board) return [course, year, board[1]!, board[2]!.trim()];

  // Remarks often start with these verbs/nouns
  const remark = rest.match(/^(.*?)\s+((?:Scored|Group|Cleared|Distinction|Awarded|Passed|Rank)\b.*)$/i);
  if (remark && remark[1]!.trim().length > 0) {
    return [course, year, remark[1]!.trim(), remark[2]!.trim()];
  }

  const parts = rest.split(/\s+/);
  if (parts.length <= 2) return [course, year, rest, ''];
  return [course, year, parts[0]!, parts.slice(1).join(' ')];
}

/** Full-width horizontal rule via a 1-cell table (Pages-safe; pBdr is often ignored). */
function horizontalRule(colorHex: string, widthTwips: number, sz = 12): string {
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
      <w:p><w:pPr><w:spacing w:before="0" w:after="40" w:line="20" w:lineRule="exact"/></w:pPr></w:p>
    </w:tc>
  </w:tr>
</w:tbl>`;
}

function writeEducationTable(
  rowTexts: string[],
  accent: { text: string; headerFill: string; border: string; muted: string },
): string {
  const headers = ['Course', 'Year', 'Institution/Board', 'Remarks'];
  // Proportional widths: Course narrow, Remarks wide to avoid text wrapping
  const widths = [2100, 1400, 2500, 4460];
  const fillC = accent.headerFill.replace('#', '');
  const borderC = accent.border.replace('#', '');
  const rowBorderC = 'D0D0D0';
  // PDF: dashed green header band, no vertical grid — only faint row separators
  const headerCells = headers
    .map(
      (h, hi) =>
        `<w:tc><w:tcPr><w:tcW w:w="${widths[hi]}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="${fillC}"/><w:vAlign w:val="center"/><w:tcBorders><w:top w:val="dashed" w:sz="8" w:space="0" w:color="${borderC}"/><w:left w:val="nil"/><w:bottom w:val="dashed" w:sz="8" w:space="0" w:color="${borderC}"/><w:right w:val="nil"/></w:tcBorders></w:tcPr>${compactCellParagraph(runText(h, { bold: true, color: accent.text, fontSizePt: 9 }))}</w:tc>`,
    )
    .join('');
  const zebraFill = 'F3F7F3';
  const rows = rowTexts.map((rt, ri) => {
    const cols = parseEducationRow(rt);
    const rowFill = ri % 2 === 1 ? zebraFill : null;
    const cells = cols
      .map(
        (c, ci) =>
          `<w:tc><w:tcPr><w:tcW w:w="${widths[ci] ?? widths[3]}" w:type="dxa"/>${rowFill ? `<w:shd w:val="clear" w:color="auto" w:fill="${rowFill}"/>` : ''}<w:vAlign w:val="center"/><w:tcBorders><w:top w:val="nil"/><w:left w:val="nil"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="${rowBorderC}"/><w:right w:val="nil"/></w:tcBorders></w:tcPr>${compactCellParagraph(runText(c || ' ', { fontSizePt: 8 }))}</w:tc>`,
      )
      .join('');
    return `<w:tr>${cells}</w:tr>`;
  });
  return `<w:tbl>
  <w:tblPr>
    <w:tblW w:w="0" w:type="auto"/>
    <w:tblCellMar>
      <w:top w:w="20" w:type="dxa"/><w:left w:w="40" w:type="dxa"/>
      <w:bottom w:w="20" w:type="dxa"/><w:right w:w="40" w:type="dxa"/>
    </w:tblCellMar>
    <w:tblBorders>
      <w:top w:val="nil"/>
      <w:left w:val="nil"/>
      <w:bottom w:val="nil"/>
      <w:right w:val="nil"/>
      <w:insideH w:val="nil"/>
      <w:insideV w:val="nil"/>
    </w:tblBorders>
  </w:tblPr>
  <w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>
  <w:tr>${headerCells}</w:tr>
  ${rows.join('\n')}
</w:tbl>`;
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
