import type { RecognitionBlock, RecognitionWord } from './types.js';

export interface EstimatedFont {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  rotation: number;
  alignment: 'left' | 'center' | 'right' | 'justify';
  confidence: number;
}

/** Estimate typography from OCR/parser geometry when native fonts are missing. */
export function estimateFonts(
  words: RecognitionWord[],
  block: RecognitionBlock,
): EstimatedFont {
  const heights = words.map((w) => w.bbox.height).filter((h) => h > 0);
  const fontSize = heights.length
    ? median(heights) * 0.95
    : Math.max(8, block.bbox.height * 0.8);

  const xs = words.map((w) => w.bbox.x);
  const left = Math.min(...xs, block.bbox.x);
  const rightEdges = words.map((w) => w.bbox.x + w.bbox.width);
  const right = Math.max(...rightEdges, block.bbox.x + block.bbox.width);
  const mid = (left + right) / 2;
  const blockMid = block.bbox.x + block.bbox.width / 2;

  let alignment: EstimatedFont['alignment'] = 'left';
  if (Math.abs(mid - blockMid) < block.bbox.width * 0.12) alignment = 'center';
  else if (block.bbox.x + block.bbox.width - right < 8) alignment = 'right';

  const text = block.text;
  const bold = text === text.toUpperCase() && /[A-Z]{3,}/.test(text);
  const italic = false;

  return {
    fontFamily: 'Helvetica',
    fontSize: Math.round(fontSize * 10) / 10,
    bold,
    italic,
    underline: false,
    rotation: 0,
    alignment,
    confidence: words.length ? 0.65 : 0.4,
  };
}

function median(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 12;
}
