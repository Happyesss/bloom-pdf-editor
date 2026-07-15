import type { LogicalTable } from '../../table/types.js';
import { bboxToEmu, esc, nextShapeId } from './shapes.js';

/** Native editable PowerPoint table (not an image). */
export function tableGraphicFrame(table: LogicalTable): string {
  const id = nextShapeId();
  const e = bboxToEmu(table.bbox);
  const colCount = Math.max(table.columns.length, 1);
  const rowCount = Math.max(table.rows.length, 1);

  const gridCols = table.columns
    .map((c) => {
      const w = Math.max(bboxToEmu({ x: 0, y: 0, width: c.width || 80, height: 1 }).cx, 200000);
      return `<a:gridCol w="${w}"/>`;
    })
    .join('');

  // Fill missing columns if needed
  const colsXml =
    gridCols ||
    Array.from({ length: colCount }, () => `<a:gridCol w="914400"/>`).join('');

  const rowsXml: string[] = [];
  for (let r = 0; r < rowCount; r++) {
    const row = table.rows[r];
    const h = Math.max(
      bboxToEmu({ x: 0, y: 0, width: 1, height: row?.height || 18 }).cy,
      200000,
    );
    const tcs: string[] = [];
    for (let c = 0; c < colCount; c++) {
      const cell = table.cells.find((x) => x.rowIndex === r && x.colIndex === c);
      const text = cell?.text ?? '';
      const bold = row?.role === 'header' ? '<a:b/>' : '';
      tcs.push(`<a:tc>
  <a:txBody>
    <a:bodyPr/><a:lstStyle/>
    <a:p><a:r><a:rPr lang="en-US" sz="1200" dirty="0">${bold}</a:rPr><a:t>${esc(text)}</a:t></a:r></a:p>
  </a:txBody>
  <a:tcPr/>
</a:tc>`);
    }
    rowsXml.push(`<a:tr h="${h}">${tcs.join('')}</a:tr>`);
  }

  return `<p:graphicFrame>
  <p:nvGraphicFramePr>
    <p:cNvPr id="${id}" name="Table ${id}"/>
    <p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/></p:cNvGraphicFramePr>
    <p:nvPr/>
  </p:nvGraphicFramePr>
  <p:xfrm>
    <a:off x="${e.x}" y="${e.y}"/>
    <a:ext cx="${e.cx}" cy="${e.cy}"/>
  </p:xfrm>
  <a:graphic>
    <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table">
      <a:tbl>
        <a:tblPr firstRow="1" bandRow="1"/>
        <a:tblGrid>${colsXml}</a:tblGrid>
        ${rowsXml.join('\n')}
      </a:tbl>
    </a:graphicData>
  </a:graphic>
</p:graphicFrame>`;
}
