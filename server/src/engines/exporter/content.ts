import type { LogicalTable } from '../table/types.js';
import type { UnifiedDocumentModel } from '../udm/types.js';

/** Format-agnostic reading-order blocks extracted from UDM (no PDF). */

export type ContentBlock =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'quote'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'caption'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; table: LogicalTable }
  | { kind: 'image'; alt: string }
  | { kind: 'link'; text: string; uri: string };

export function extractContentBlocks(udm: UnifiedDocumentModel): ContentBlock[] {
  const out: ContentBlock[] = [];
  const tableById = new Map(udm.tables.map((t) => [t.id, t]));
  const emittedTables = new Set<string>();
  const emittedLists = new Set<string>();

  for (const nodeId of udm.semantic.readingOrder) {
    const node = udm.semantic.nodes[nodeId];
    if (!node) continue;

    if (node.type === 'table') {
      const logicalId = 'logicalTableId' in node ? String(node.logicalTableId) : '';
      const table = tableById.get(logicalId);
      if (table && !emittedTables.has(table.id)) {
        out.push({ kind: 'table', table });
        emittedTables.add(table.id);
      }
      continue;
    }

    if (node.type === 'list') {
      if (emittedLists.has(node.id)) continue;
      emittedLists.add(node.id);
      const items = node.childIds
        .map((id) => udm.semantic.nodes[id])
        .filter((n) => n?.type === 'list_item')
        .map((n) => ('text' in n! ? String(n!.text ?? '') : ''))
        .filter(Boolean);
      const ordered =
        'listStyle' in node &&
        (node.listStyle === 'numbered' ||
          node.listStyle === 'alphabetic' ||
          node.listStyle === 'roman');
      out.push({ kind: 'list', ordered: !!ordered, items });
      continue;
    }

    if (node.type === 'list_item') continue;

    if (node.type === 'image') {
      out.push({ kind: 'image', alt: 'alt' in node ? String(node.alt ?? 'Image') : 'Image' });
      continue;
    }

    if (node.type === 'hyperlink' && 'uri' in node) {
      out.push({
        kind: 'link',
        text: 'text' in node ? String(node.text ?? node.uri) : String(node.uri),
        uri: String(node.uri),
      });
      continue;
    }

    if (!('text' in node) || node.text == null) continue;
    const text = String(node.text);
    if (!text.trim()) continue;

    if (node.type === 'heading' || node.type === 'title' || node.type === 'subtitle') {
      const level =
        node.type === 'title'
          ? 1
          : node.type === 'subtitle'
            ? 2
            : Math.min(6, Math.max(1, 'level' in node ? Number(node.level) || 2 : 2));
      out.push({ kind: 'heading', level, text });
    } else if (node.type === 'quote') {
      out.push({ kind: 'quote', text });
    } else if (node.type === 'code_block') {
      out.push({ kind: 'code', text });
    } else if (node.type === 'caption') {
      out.push({ kind: 'caption', text });
    } else {
      out.push({ kind: 'paragraph', text });
    }
  }

  for (const t of udm.tables) {
    if (!emittedTables.has(t.id)) out.push({ kind: 'table', table: t });
  }

  if (out.length === 0) {
    out.push({ kind: 'paragraph', text: udm.metadata.title ?? 'Document' });
  }

  return out;
}

export function sanitizeFilename(name: string, fallback: string): string {
  return name.replace(/[^\w\-]+/g, '_').slice(0, 64) || fallback;
}

export function escHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function escXml(s: string): string {
  return escHtml(s);
}

export function tableToRows(table: LogicalTable): string[][] {
  const rows: string[][] = [];
  for (let r = 0; r < table.rows.length; r++) {
    const row: string[] = [];
    for (let c = 0; c < table.columns.length; c++) {
      const cell = table.cells.find((x) => x.rowIndex === r && x.colIndex === c);
      row.push(cell?.text ?? '');
    }
    rows.push(row);
  }
  return rows;
}
