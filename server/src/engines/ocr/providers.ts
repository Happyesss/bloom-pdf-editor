import type { IOcrProvider, OcrProviderResult } from './types.js';

/** Default provider — no native OCR binary. Returns empty results. */
export class NullOcrProvider implements IOcrProvider {
  readonly name = 'NullOcrProvider';

  async recognize(input: {
    pageIndex: number;
    width: number;
    height: number;
    imageBytes?: Uint8Array;
    languages?: string[];
  }): Promise<OcrProviderResult> {
    void input.imageBytes;
    void input.languages;
    return { pageIndex: input.pageIndex, blocks: [] };
  }
}

/**
 * Test / demo provider — synthesizes OCR text for large image pages.
 * Pluggable handwriting providers can replace this.
 */
export class SyntheticOcrProvider implements IOcrProvider {
  readonly name = 'SyntheticOcrProvider';

  constructor(
    private readonly script: Array<{
      pageIndex: number;
      text: string;
      x?: number;
      y?: number;
      confidence?: number;
    }> = [],
  ) {}

  async recognize(input: {
    pageIndex: number;
    width: number;
    height: number;
    imageBytes?: Uint8Array;
    languages?: string[];
  }): Promise<OcrProviderResult> {
    void input.imageBytes;
    const lines = this.script.filter((s) => s.pageIndex === input.pageIndex);
    if (lines.length === 0) {
      return { pageIndex: input.pageIndex, language: 'en', blocks: [] };
    }
    return {
      pageIndex: input.pageIndex,
      language: input.languages?.[0] ?? 'en',
      blocks: lines.map((line, i) => {
        const x = line.x ?? 72;
        const y = line.y ?? input.height - 72 - i * 18;
        const w = Math.min(input.width - x - 36, line.text.length * 7);
        return {
          text: line.text,
          bbox: { x, y, width: w, height: 14 },
          confidence: line.confidence ?? 0.82,
          words: line.text.split(/\s+/).map((word, wi) => ({
            text: word,
            bbox: {
              x: x + wi * 40,
              y,
              width: word.length * 7,
              height: 14,
            },
            confidence: line.confidence ?? 0.82,
          })),
        };
      }),
    };
  }
}
