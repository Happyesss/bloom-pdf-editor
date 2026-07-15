import type { BoundingBox } from '../../common/geometry.js';

/** PDF points → EMUs (English Metric Units). 1 pt = 12700 EMU. */
export function ptToEmu(pt: number): number {
  return Math.round(pt * 12700);
}

export function bboxToEmu(bbox: BoundingBox): {
  x: number;
  y: number;
  cx: number;
  cy: number;
} {
  return {
    x: ptToEmu(bbox.x),
    y: ptToEmu(bbox.y),
    cx: Math.max(ptToEmu(bbox.width), 12700),
    cy: Math.max(ptToEmu(bbox.height), 12700),
  };
}

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

let shapeId = 2;

export function nextShapeId(): number {
  return shapeId++;
}

export function resetShapeIds(): void {
  shapeId = 2;
}

/** Editable text box at bbox. */
export function textBoxSp(
  text: string,
  bbox: BoundingBox,
  opts: { bold?: boolean; fontSizePt?: number; name?: string } = {},
): string {
  const id = nextShapeId();
  const e = bboxToEmu(bbox);
  const sz = Math.round((opts.fontSizePt ?? 14) * 100); // hundredths of a point
  const bold = opts.bold ? '<a:b/>' : '';
  const name = opts.name ?? 'TextBox';
  return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="${id}" name="${esc(name)} ${id}"/>
    <p:cNvSpPr txBox="1"/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="${e.x}" y="${e.y}"/>
      <a:ext cx="${e.cx}" cy="${e.cy}"/>
    </a:xfrm>
    <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
    <a:noFill/>
  </p:spPr>
  <p:txBody>
    <a:bodyPr wrap="square" rtlCol="0"/>
    <a:lstStyle/>
    <a:p>
      <a:r>
        <a:rPr lang="en-US" sz="${sz}" dirty="0">${bold}<a:solidFill><a:srgbClr val="000000"/></a:solidFill>
          <a:latin typeface="Calibri"/>
        </a:rPr>
        <a:t>${esc(text)}</a:t>
      </a:r>
    </a:p>
  </p:txBody>
</p:sp>`;
}

/** Native rectangle or line shape. */
export function vectorSp(
  kind: 'rectangle' | 'line',
  bbox: BoundingBox,
): string {
  const id = nextShapeId();
  const e = bboxToEmu(bbox);
  const prst = kind === 'line' ? 'line' : 'rect';
  return `<p:sp>
  <p:nvSpPr>
    <p:cNvPr id="${id}" name="Shape ${id}"/>
    <p:cNvSpPr/>
    <p:nvPr/>
  </p:nvSpPr>
  <p:spPr>
    <a:xfrm>
      <a:off x="${e.x}" y="${e.y}"/>
      <a:ext cx="${e.cx}" cy="${e.cy}"/>
    </a:xfrm>
    <a:prstGeom prst="${prst}"><a:avLst/></a:prstGeom>
    <a:ln w="12700"><a:solidFill><a:srgbClr val="333333"/></a:solidFill></a:ln>
    ${kind === 'rectangle' ? '<a:solidFill><a:srgbClr val="D9E2F3"/></a:solidFill>' : '<a:noFill/>'}
  </p:spPr>
  <p:style>
    <a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef>
    <a:fillRef idx="0"><a:schemeClr val="accent1"/></a:fillRef>
    <a:effectRef idx="0"><a:schemeClr val="accent1"/></a:effectRef>
    <a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef>
  </p:style>
  <p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>
</p:sp>`;
}
