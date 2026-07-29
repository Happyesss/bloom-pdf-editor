/**
 * DrawingML image writer for OOXML DOCX packages.
 * Generates <w:drawing> with <wp:inline> for embedding images.
 */

import { esc } from '../ooxml/xml.js';

/** 1 pt = 12700 EMU (English Metric Units, used by DrawingML). */
export function emuFromPt(pt: number): number {
  return Math.round(pt * 12700);
}

/** 1 px at given DPI → EMU. Default 96 DPI. */
export function emuFromPx(px: number, dpi = 96): number {
  return Math.round((px / dpi) * 914400);
}

/** Resolve file extension from MIME type. */
export function extensionFromMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpeg';
    case 'image/png':
      return 'png';
    case 'image/gif':
      return 'gif';
    case 'image/tiff':
      return 'tiff';
    case 'image/bmp':
      return 'bmp';
    case 'image/webp':
      return 'webp';
    default:
      return 'png';
  }
}

export interface InlineImageOpts {
  /** Width in EMU. */
  cx: number;
  /** Height in EMU. */
  cy: number;
  /** Relationship ID for the embedded image (e.g. "rId10"). */
  rId: string;
  /** Unique drawing object ID (incremented per document). */
  docPrId: number;
  /** Descriptive name for accessibility. */
  name: string;
}

/**
 * Generate an inline DrawingML image paragraph element.
 * Produces a complete <w:p> containing <w:drawing><wp:inline>…</wp:inline></w:drawing>.
 */
export function writeInlineImage(opts: InlineImageOpts): string {
  const { cx, cy, rId, docPrId, name } = opts;
  const safeName = esc(name);

  return `<w:p>
  <w:pPr><w:spacing w:before="60" w:after="60"/></w:pPr>
  <w:r>
    <w:drawing>
      <wp:inline distT="0" distB="0" distL="0" distR="0"
        xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing">
        <wp:extent cx="${cx}" cy="${cy}"/>
        <wp:effectExtent l="0" t="0" r="0" b="0"/>
        <wp:docPr id="${docPrId}" name="${safeName}"/>
        <wp:cNvGraphicFramePr>
          <a:graphicFrameLocks noChangeAspect="1"
            xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"/>
        </wp:cNvGraphicFramePr>
        <a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
          <a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">
            <pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"
              xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
              <pic:nvPicPr>
                <pic:cNvPr id="${docPrId}" name="${safeName}"/>
                <pic:cNvPicPr/>
              </pic:nvPicPr>
              <pic:blipFill>
                <a:blip r:embed="${rId}"/>
                <a:stretch><a:fillRect/></a:stretch>
              </pic:blipFill>
              <pic:spPr>
                <a:xfrm>
                  <a:off x="0" y="0"/>
                  <a:ext cx="${cx}" cy="${cy}"/>
                </a:xfrm>
                <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
              </pic:spPr>
            </pic:pic>
          </a:graphicData>
        </a:graphic>
      </wp:inline>
    </w:drawing>
  </w:r>
</w:p>`;
}

/**
 * Constrain image dimensions to fit within page content width,
 * preserving aspect ratio. All units are EMU.
 */
export function constrainToPageWidth(
  cx: number,
  cy: number,
  maxWidthEmu: number,
): { cx: number; cy: number } {
  if (cx <= maxWidthEmu) return { cx, cy };
  const scale = maxWidthEmu / cx;
  return {
    cx: maxWidthEmu,
    cy: Math.round(cy * scale),
  };
}
