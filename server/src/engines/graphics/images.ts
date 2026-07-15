import { createId } from '../../utils/id.js';
import type { IImageDetector, GraphicsEngineInput } from './algorithms/types.js';
import type { GraphicImage } from './types.js';

/**
 * Reconstruct images from RawDocument — metadata only, never copy bytes.
 */
export class ImageDetector implements IImageDetector {
  readonly name = 'ImageDetector';

  detect(input: GraphicsEngineInput): GraphicImage[] {
    const out: GraphicImage[] = [];
    for (const page of input.raw.pages) {
      for (const img of page.images) {
        const resourceKey = [
          img.resourceName ?? img.id,
          img.widthPx,
          img.heightPx,
          img.imageType,
          img.compression ?? '',
        ].join(':');

        out.push({
          id: createId('gimg'),
          kind: 'image',
          pageIndex: page.index,
          bbox: { ...img.bbox },
          transform: img.transform,
          rotation: img.rotation,
          opacity: 1,
          layer: img.layer,
          zIndex: img.zIndex,
          parentId: null,
          childIds: [],
          wrap: 'inline',
          sourceIds: [img.id],
          confidence: 0.95,
          imageType: img.imageType,
          widthPx: img.widthPx,
          heightPx: img.heightPx,
          dpi: img.dpi,
          compression: img.compression,
          colorSpace: img.colorSpace,
          hasTransparency: img.hasTransparency,
          resourceName: img.resourceName,
          resourceKey,
        });
      }
    }
    return out;
  }
}
