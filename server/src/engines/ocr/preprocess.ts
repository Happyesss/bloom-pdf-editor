/**
 * Image preprocessing hooks for OCR (deskew, binarize, etc.).
 * Pure metadata / plan stage — actual pixel ops are provider-side.
 */
export interface PreprocessPlan {
  deskew: boolean;
  rotateDegrees: number;
  noiseRemoval: boolean;
  contrastEnhance: boolean;
  binarize: boolean;
  adaptiveThreshold: boolean;
  perspectiveCorrect: boolean;
  borderRemoval: boolean;
}

export function planPreprocess(opts: {
  kind: string;
  rotation?: number;
}): PreprocessPlan {
  const scanned = opts.kind === 'scanned' || opts.kind === 'fax' || opts.kind === 'photo';
  return {
    deskew: scanned,
    rotateDegrees: opts.rotation ?? 0,
    noiseRemoval: opts.kind === 'fax' || opts.kind === 'scanned',
    contrastEnhance: scanned,
    binarize: opts.kind === 'fax',
    adaptiveThreshold: scanned,
    perspectiveCorrect: opts.kind === 'photo',
    borderRemoval: scanned,
  };
}
