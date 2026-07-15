import type { GraphicObject } from '../../graphics/types.js';
import type { UnifiedDocumentModel } from '../../udm/types.js';
import { resetShapeIds, textBoxSp, vectorSp } from './shapes.js';
import { tableGraphicFrame } from './tables.js';

const SKIP_TYPES = new Set([
  'table',
  'list',
  'section',
  'subsection',
  'document',
  'hyperlink',
]);

export function buildSlideXml(
  udm: UnifiedDocumentModel,
  pageIndex: number,
  absorbedIds: Set<string>,
): string {
  resetShapeIds();
  const parts: string[] = [];

  // Tables on this page
  for (const table of udm.tables.filter((t) => t.pageIndex === pageIndex)) {
    parts.push(tableGraphicFrame(table));
  }

  // Text nodes (skip absorbed into tables)
  const nodes = Object.values(udm.semantic.nodes)
    .filter((n) => n.pageIndex === pageIndex && n.bbox && !SKIP_TYPES.has(n.type))
    .filter((n) => !absorbedIds.has(n.id))
    .sort((a, b) => a.readingOrderIndex - b.readingOrderIndex);

  for (const n of nodes) {
    if (n.type === 'list_item') continue;
    if (n.type === 'image') {
      const alt = 'alt' in n ? String(n.alt ?? 'Image') : 'Image';
      parts.push(textBoxSp(`[Image: ${alt}]`, n.bbox!, { fontSizePt: 12, name: 'Image' }));
      continue;
    }
    if (!('text' in n) || !n.text?.trim()) continue;
    const bold = n.type === 'heading' || n.type === 'title' || n.type === 'subtitle';
    const fontSize =
      n.type === 'title' ? 28 : n.type === 'heading' ? 20 : n.type === 'subtitle' ? 18 : 14;
    parts.push(
      textBoxSp(String(n.text), n.bbox!, {
        bold,
        fontSizePt: fontSize,
        name: n.type,
      }),
    );
  }

  // Native shapes from graphics
  const graphics = (udm.graphics?.objects ?? []).filter(
    (o): o is Extract<GraphicObject, { kind: 'vector' }> =>
      o.pageIndex === pageIndex && o.kind === 'vector',
  );
  for (const v of graphics) {
    if (v.shape === 'rectangle' || v.shape === 'rounded_rectangle') {
      parts.push(vectorSp('rectangle', v.bbox));
    } else if (v.shape === 'line') {
      parts.push(vectorSp('line', v.bbox));
    }
  }

  if (parts.length === 0) {
    parts.push(
      textBoxSp(`Page ${pageIndex + 1}`, { x: 72, y: 72, width: 400, height: 40 }, {
        fontSizePt: 18,
        bold: true,
      }),
    );
  }

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="0" cy="0"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="0" cy="0"/>
        </a:xfrm>
      </p:grpSpPr>
      ${parts.join('\n')}
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>
</p:sld>`;
}

export function collectAbsorbedNodeIds(udm: UnifiedDocumentModel): Set<string> {
  const ids = new Set<string>();
  for (const t of udm.tables) {
    for (const c of t.cells) {
      for (const id of c.contentNodeIds) ids.add(id);
    }
  }
  for (const n of Object.values(udm.semantic.nodes)) {
    if (n.type === 'table' && 'absorbedNodeIds' in n) {
      for (const id of n.absorbedNodeIds as string[]) ids.add(id);
    }
  }
  return ids;
}

export function pageIndices(udm: UnifiedDocumentModel): number[] {
  const set = new Set<number>();
  for (const n of Object.values(udm.semantic.nodes)) set.add(n.pageIndex);
  for (const t of udm.tables) set.add(t.pageIndex);
  for (const o of udm.graphics?.objects ?? []) set.add(o.pageIndex);
  for (const section of udm.idm.sections) {
    for (const page of section.pages) set.add(page.index);
  }
  if (set.size === 0) set.add(0);
  return [...set].sort((a, b) => a - b);
}

export function slideSizeEmu(udm: UnifiedDocumentModel): { cx: number; cy: number } {
  const page = udm.idm.sections[0]?.pages[0];
  const w = page?.width ?? 612;
  const h = page?.height ?? 792;
  return { cx: Math.round(w * 12700), cy: Math.round(h * 12700) };
}
