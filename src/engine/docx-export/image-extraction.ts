import * as Engine from '../index';
import type { ExtractedPageData } from './glyph-extraction';
import type { ImageBlock } from './types';
import type { PDFPageInfo, PDFObject } from '../types';

async function rgbaToPngBytes(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<Uint8Array | null> {
  try {
    const canvas =
      typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(width, height)
        : (() => {
            const c = document.createElement('canvas');
            c.width = width;
            c.height = height;
            return c;
          })();

    const ctx = canvas.getContext('2d') as
      | OffscreenCanvasRenderingContext2D
      | CanvasRenderingContext2D
      | null;
    if (!ctx) return null;

    const imageData = new ImageData(new Uint8ClampedArray(data), width, height);
    ctx.putImageData(imageData, 0, 0);

    if ('convertToBlob' in canvas && typeof canvas.convertToBlob === 'function') {
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return new Uint8Array(await blob.arrayBuffer());
    }

    const blob = await new Promise<Blob | null>((resolve) => {
      (canvas as HTMLCanvasElement).toBlob(resolve, 'image/png');
    });
    if (!blob) return null;
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

export async function extractImages(
  data: ExtractedPageData,
  page: PDFPageInfo,
  objects: Map<string, PDFObject>,
): Promise<ImageBlock[]> {
  const imageBlocks: ImageBlock[] = [];

  for (const item of data.displayList) {
    if (item.type !== 'image') continue;

    const xobj = Engine.getResource(page.resources, 'XObject', item.name, objects);
    if (!xobj || !('dict' in xobj)) continue;

    const stream = xobj as Engine.PDFStream;
    const decoded = await Engine.decodeImage(stream, objects);
    if (!decoded) continue;

    // Skip near-full-page images (backgrounds / scans)
    // already positions text; full-page rasters bloat the file.
    if (item.width >= page.mediaBox.width * 0.9 && item.height >= page.mediaBox.height * 0.9) {
      continue;
    }

    const png = await rgbaToPngBytes(decoded.data, decoded.width, decoded.height);
    if (!png || png.length === 0) continue;

    imageBlocks.push({
      type: 'image',
      x: item.x,
      y: item.y,
      width: item.width,
      height: item.height,
      imageData: png,
      mimeType: 'image/png',
    });
  }

  return imageBlocks;
}
