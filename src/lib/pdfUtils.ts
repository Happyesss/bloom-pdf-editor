import * as pdfLib from 'pdf-lib';
import type { PageOverlay } from '@/types/editor';

export async function exportPdfWithOverlays(
  originalBytes: ArrayBuffer,
  overlays: Record<number, PageOverlay>,
  pageOrder?: number[],   // 0-based indices in desired order
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

  // For each page with an overlay, render the Fabric canvas overlay as PNG and embed it
  for (let i = 0; i < totalPages; i++) {
    const overlay = overlays[i];
    if (!overlay || !overlay.json) continue;

    const page = pdfDoc.getPages()[i];
    const { width, height } = page.getSize();

    // The overlay JSON was produced by Fabric canvas at a scaled size.
    // We embed the data URL that was stored in the overlay (see PageCanvas.tsx export).
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
    const radians = (angle * Math.PI) / 180;
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
