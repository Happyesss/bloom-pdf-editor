import * as pdfLib from 'pdf-lib';
import type { PageOverlay } from '@/types/editor';

export async function exportPdfWithOverlays(
  originalBytes: ArrayBuffer,
  overlays: Record<number, PageOverlay>,
  textEdits?: Record<number, Record<string, string>>,   // pageIndex → blockId → newText
  textBlockPositions?: Record<number, Record<string, { left: number; top: number; width: number; height: number; fontSize: number; fontFamily: string }>>,
  deletedPages?: Set<number>,
  rotations?: Record<number, number>,
): Promise<Uint8Array> {
  const pdfDoc = await pdfLib.PDFDocument.load(originalBytes);
  const totalPages = pdfDoc.getPageCount();

  // Apply rotations to pages
  if (rotations) {
    for (let i = 0; i < totalPages; i++) {
      const rot = rotations[i];
      if (rot !== undefined && rot !== 0) {
        const page = pdfDoc.getPages()[i];
        const current = page.getRotation().angle;
        page.setRotation(pdfLib.degrees((current + rot) % 360));
      }
    }
  }

  // For each page with text edits, apply them via pdf-lib
  if (textEdits && textBlockPositions) {
    const helvetica = await pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(pdfLib.StandardFonts.HelveticaBold);

    for (let i = 0; i < totalPages; i++) {
      const pageEdits = textEdits[i];
      const pageBlocks = textBlockPositions[i];
      if (!pageEdits || !pageBlocks) continue;

      const page = pdfDoc.getPages()[i];
      const { height: pageHeight } = page.getSize();

      for (const [blockId, rawText] of Object.entries(pageEdits)) {
        const block = pageBlocks[blockId];
        if (!block) continue;
        // textEdits now stores HTML (with <b>/<i> tags) — strip to plain text for PDF
        const newText = rawText.replace(/<[^>]+>/g, '');
        if (!newText.trim()) continue;

        // The block coordinates are in screen pixels (at scale used by the editor)
        // We need to convert back to PDF points
        // The scale factor stored in blockPositions should match the rendering scale
        // For now we assume scale=1.5 (default: zoom=1 * 1.5)
        // In a production system you'd store the scale alongside positions
        const editorScale = 1.5;

        const pdfX = block.left / editorScale;
        const pdfY = pageHeight - (block.top + block.height) / editorScale;
        const pdfFontSize = block.fontSize / editorScale;
        const pdfWidth = block.width / editorScale + 20;
        const pdfHeight = block.height / editorScale + 4;

        // Cover original text with white rectangle
        page.drawRectangle({
          x: pdfX - 2,
          y: pdfY - 2,
          width: pdfWidth,
          height: pdfHeight,
          color: pdfLib.rgb(1, 1, 1),
          borderWidth: 0,
        });

        // Draw new text
        const isBold = block.fontFamily.toLowerCase().includes('bold');
        try {
          page.drawText(newText, {
            x: pdfX,
            y: pdfY + 2,
            size: Math.max(4, pdfFontSize),
            font: isBold ? helveticaBold : helvetica,
            color: pdfLib.rgb(0, 0, 0),
            maxWidth: pdfWidth,
          });
        } catch {
          // If text rendering fails (special chars etc), skip
        }
      }
    }
  }

  // For each page with a Fabric overlay, embed the overlay PNG on top
  for (let i = 0; i < totalPages; i++) {
    const overlay = overlays[i];
    if (!overlay || !overlay.json) continue;

    const page = pdfDoc.getPages()[i];
    const { width, height } = page.getSize();

    try {
      const parsed = JSON.parse(overlay.json);
      if (parsed.__dataUrl) {
        const base64 = parsed.__dataUrl.split(',')[1];
        const imgBytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const pngImage = await pdfDoc.embedPng(imgBytes);
        page.drawImage(pngImage, { x: 0, y: 0, width, height });
      }
    } catch {
      // overlay may not have a data URL yet – skip
    }
  }

  // Handle page deletion and reordering
  if (deletedPages && deletedPages.size > 0) {
    const indicesToRemove = Array.from(deletedPages).sort((a, b) => b - a);
    for (const idx of indicesToRemove) {
      pdfDoc.removePage(idx);
    }
  }

  return pdfDoc.save();
}

export async function addWatermarkToPdf(
  pdfBytes: Uint8Array,
  text: string,
  options: {
    fontSize?: number;
    color?: [number, number, number];
    opacity?: number;
    angle?: number;
    repeat?: boolean;
  } = {}
): Promise<Uint8Array> {
  const { fontSize = 48, color = [0.7, 0.7, 0.7], opacity = 0.4, angle = 45, repeat = true } = options;
  const pdfDoc = await pdfLib.PDFDocument.load(pdfBytes);
  const helvetica = await pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);

  const [r, g, b] = color;
  for (const page of pdfDoc.getPages()) {
    const { width, height } = page.getSize();
    const textWidth = helvetica.widthOfTextAtSize(text, fontSize);
    const positions = repeat
      ? [
          { x: width / 2 - textWidth / 2, y: height / 2 },
          { x: width / 4 - textWidth / 2, y: height * 0.75 },
          { x: (width * 3) / 4 - textWidth / 2, y: height * 0.25 },
        ]
      : [{ x: width / 2 - textWidth / 2, y: height / 2 }];

    for (const pos of positions) {
      page.drawText(text, {
        x: pos.x,
        y: pos.y,
        size: fontSize,
        font: helvetica,
        color: pdfLib.rgb(r, g, b),
        opacity,
        rotate: pdfLib.degrees(angle),
      });
    }
  }

  return pdfDoc.save();
}
