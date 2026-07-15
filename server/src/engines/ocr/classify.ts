import type { RawPage } from '../parser/raw-model.js';
import type { ImageRegionHint, PageContentKind } from './types.js';

export interface PageClassification {
  kind: PageContentKind;
  textCoverage: number;
  imageCoverage: number;
  charCount: number;
  needsOcr: boolean;
  imageRegions: ImageRegionHint[];
  confidence: number;
}

/** Classify a page as digital / scanned / hybrid / photo / mixed. */
export function classifyPage(page: RawPage): PageClassification {
  const pageArea = Math.max(page.width * page.height, 1);
  const charCount = page.characters.length;
  const textArea = page.characters.reduce((s, c) => s + c.bbox.width * c.bbox.height, 0);
  const imageArea = page.images.reduce((s, i) => s + i.bbox.width * i.bbox.height, 0);
  const textCoverage = Math.min(1, textArea / pageArea);
  const imageCoverage = Math.min(1, imageArea / pageArea);

  const imageRegions = page.images.map((img) => ({
    id: img.id,
    kind: hintImageKind(img, pageArea),
    bbox: { ...img.bbox },
    confidence: 0.7,
  }));

  let kind: PageContentKind = 'digital';
  let needsOcr = false;
  let confidence = 0.8;

  if (charCount < 8 && imageCoverage > 0.55) {
    kind = imageCoverage > 0.85 ? 'scanned' : 'photo';
    needsOcr = true;
    confidence = 0.85;
  } else if (charCount < 40 && imageCoverage > 0.35) {
    kind = 'hybrid';
    needsOcr = true;
    confidence = 0.75;
  } else if (charCount >= 40 && imageCoverage > 0.25) {
    kind = 'mixed';
    needsOcr = imageCoverage > 0.5 && textCoverage < 0.05;
    confidence = 0.7;
  } else if (charCount === 0 && page.vectors.length > 20 && imageCoverage < 0.1) {
    kind = 'digital'; // vector drawing
    needsOcr = false;
    confidence = 0.6;
  } else {
    kind = 'digital';
    needsOcr = false;
    confidence = charCount > 0 ? 0.9 : 0.5;
  }

  // Fax-like: single large B&W image
  if (
    needsOcr &&
    page.images.length === 1 &&
    (page.images[0]!.colorSpace === 'DeviceGray' || page.images[0]!.imageType === 'ccitt')
  ) {
    kind = 'fax';
  }

  return {
    kind,
    textCoverage,
    imageCoverage,
    charCount,
    needsOcr,
    imageRegions,
    confidence,
  };
}

function hintImageKind(
  img: { bbox: { width: number; height: number }; widthPx: number; heightPx: number },
  pageArea: number,
): ImageRegionHint['kind'] {
  const cov = (img.bbox.width * img.bbox.height) / pageArea;
  if (cov > 0.5) return 'photo';
  const aspect = img.bbox.width / Math.max(img.bbox.height, 1);
  if (aspect > 3 || aspect < 0.35) return 'logo';
  if (img.bbox.width < 80 && img.bbox.height < 40) return 'signature';
  return 'unknown';
}
