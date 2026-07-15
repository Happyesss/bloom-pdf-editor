import { createId } from '../../utils/id.js';
import type { RawCharacter, RawDocument, RawPage } from '../parser/raw-model.js';
import { PageSpatialIndex } from '../parser/spatial-index.js';
import type { PageClassification } from './classify.js';
import { estimateFonts } from './fonts.js';
import { detectLanguage } from './language.js';
import type {
  OcrProviderResult,
  RecognitionBlock,
  RecognitionCharacter,
  RecognitionDocument,
  RecognitionPage,
  RecognitionWord,
} from './types.js';

/**
 * Merge OCR with parser text.
 * Prefer parser when present; use OCR only to fill gaps; never duplicate.
 */
export function mergeRecognition(
  page: RawPage,
  classification: PageClassification,
  ocr: OcrProviderResult | null,
): {
  page: RawPage;
  recognition: RecognitionPage;
} {
  const parserChars = buildParserCharacters(page);
  const parserWords = groupWords(parserChars, 'parser');
  const parserBlocks = groupBlocks(parserWords, 'parser');

  const ocrChars: RecognitionCharacter[] = [];
  const ocrWords: RecognitionWord[] = [];
  const ocrBlocks: RecognitionBlock[] = [];

  if (ocr && classification.needsOcr) {
    for (const block of ocr.blocks) {
      // Skip OCR blocks that overlap existing parser text (avoid duplicates)
      if (overlapsParserText(block.bbox, parserBlocks)) continue;

      const blockId = createId('rblock');
      const wordIds: string[] = [];
      const words = block.words?.length
        ? block.words
        : block.text.split(/\s+/).map((t, i) => ({
            text: t,
            bbox: {
              x: block.bbox.x + i * 36,
              y: block.bbox.y,
              width: t.length * 7,
              height: block.bbox.height,
            },
            confidence: block.confidence,
          }));

      for (const w of words) {
        if (!w.text) continue;
        const wordId = createId('rword');
        wordIds.push(wordId);
        const charIds: string[] = [];
        let cx = w.bbox.x;
        for (const ch of w.text) {
          const charId = createId('rchar');
          charIds.push(charId);
          const cw = Math.max(4, w.bbox.width / Math.max(w.text.length, 1));
          ocrChars.push({
            id: charId,
            text: ch,
            bbox: { x: cx, y: w.bbox.y, width: cw, height: w.bbox.height },
            confidence: w.confidence,
            source: 'ocr',
          });
          cx += cw;
        }
        ocrWords.push({
          id: wordId,
          text: w.text,
          bbox: w.bbox,
          confidence: w.confidence,
          characterIds: charIds,
          source: 'ocr',
        });
      }

      ocrBlocks.push({
        id: blockId,
        text: block.text,
        bbox: block.bbox,
        confidence: block.confidence,
        wordIds,
        printKind: 'printed',
        language: ocr.language,
        writingDirection: 'ltr',
        source: 'ocr',
      });
    }
  }

  const characters = [...parserChars, ...ocrChars];
  const words = [...parserWords, ...ocrWords];
  const blocks = [...parserBlocks, ...ocrBlocks];

  // Font estimation for OCR-only blocks
  for (const b of ocrBlocks) {
    const bWords = words.filter((w) => b.wordIds.includes(w.id));
    const font = estimateFonts(bWords, b);
    for (const w of bWords) {
      for (const cid of w.characterIds) {
        const c = characters.find((x) => x.id === cid);
        if (c) {
          c.fontSize = font.fontSize;
          c.bold = font.bold;
          c.italic = font.italic;
        }
      }
    }
  }

  const lang = detectLanguage(blocks.map((b) => b.text));
  const fusedPage =
    ocrChars.length > 0 ? injectOcrCharacters(page, ocrChars) : page;

  const charConf = avg(characters.map((c) => c.confidence));
  const wordConf = avg(words.map((w) => w.confidence));
  const paraConf = avg(blocks.map((b) => b.confidence));

  return {
    page: fusedPage,
    recognition: {
      pageIndex: page.index,
      kind: classification.kind,
      language: ocr?.language ?? lang.primary,
      script: lang.script,
      writingDirection: lang.writingDirection,
      blocks,
      words,
      characters,
      imageRegions: classification.imageRegions,
      confidence: {
        page: classification.confidence * 0.5 + paraConf * 0.5,
        character: charConf,
        word: wordConf,
        paragraph: paraConf,
      },
      ocrApplied: ocrChars.length > 0,
    },
  };
}

export function buildRecognitionDocument(
  sourceDocumentId: string,
  pages: RecognitionPage[],
): RecognitionDocument {
  const langs = pages.map((p) => p.language).filter(Boolean) as string[];
  const primary = majority(langs);
  const secondary = [...new Set(langs.filter((l) => l !== primary))];

  return {
    id: createId('recog'),
    sourceDocumentId,
    pages,
    primaryLanguage: primary,
    secondaryLanguages: secondary,
    quality: {
      character: avg(pages.map((p) => p.confidence.character)),
      word: avg(pages.map((p) => p.confidence.word)),
      paragraph: avg(pages.map((p) => p.confidence.paragraph)),
      page: avg(pages.map((p) => p.confidence.page)),
      document: avg(pages.map((p) => p.confidence.page)),
    },
  };
}

function buildParserCharacters(page: RawPage): RecognitionCharacter[] {
  return page.characters.map((c) => ({
    id: createId('rchar'),
    text: c.unicode,
    bbox: { ...c.bbox },
    confidence: 0.98,
    fontSize: c.fontSize,
    bold: c.fontWeight >= 700,
    italic: c.italic,
    source: 'parser' as const,
  }));
}

function groupWords(
  chars: RecognitionCharacter[],
  source: RecognitionWord['source'],
): RecognitionWord[] {
  if (chars.length === 0) return [];
  const sorted = [...chars].sort(
    (a, b) => b.bbox.y + b.bbox.height - (a.bbox.y + a.bbox.height) || a.bbox.x - b.bbox.x,
  );
  const words: RecognitionWord[] = [];
  let current: RecognitionCharacter[] = [];

  const flush = () => {
    if (!current.length) return;
    const text = current.map((c) => c.text).join('');
    if (!text.trim()) {
      current = [];
      return;
    }
    words.push({
      id: createId('rword'),
      text,
      bbox: union(current.map((c) => c.bbox)),
      confidence: avg(current.map((c) => c.confidence)),
      characterIds: current.map((c) => c.id),
      source,
    });
    current = [];
  };

  for (const ch of sorted) {
    if (ch.text === ' ' || ch.text === '\t') {
      flush();
      continue;
    }
    if (current.length) {
      const prev = current[current.length - 1]!;
      const gap = ch.bbox.x - (prev.bbox.x + prev.bbox.width);
      const lineBreak = Math.abs(ch.bbox.y - prev.bbox.y) > prev.bbox.height * 0.6;
      if (gap > prev.bbox.width * 0.8 || lineBreak) flush();
    }
    current.push(ch);
  }
  flush();
  return words;
}

function groupBlocks(
  words: RecognitionWord[],
  source: RecognitionBlock['source'],
): RecognitionBlock[] {
  if (words.length === 0) return [];
  const sorted = [...words].sort(
    (a, b) => b.bbox.y + b.bbox.height - (a.bbox.y + a.bbox.height) || a.bbox.x - b.bbox.x,
  );
  const blocks: RecognitionBlock[] = [];
  let current: RecognitionWord[] = [];

  const flush = () => {
    if (!current.length) return;
    blocks.push({
      id: createId('rblock'),
      text: current.map((w) => w.text).join(' '),
      bbox: union(current.map((w) => w.bbox)),
      confidence: avg(current.map((w) => w.confidence)),
      wordIds: current.map((w) => w.id),
      printKind: 'printed',
      writingDirection: 'ltr',
      source,
    });
    current = [];
  };

  for (const w of sorted) {
    if (current.length) {
      const prev = current[current.length - 1]!;
      const gap = prev.bbox.y - (w.bbox.y + w.bbox.height);
      if (gap > 18) flush();
    }
    current.push(w);
  }
  flush();
  return blocks;
}

function injectOcrCharacters(page: RawPage, ocrChars: RecognitionCharacter[]): RawPage {
  const spatial = new PageSpatialIndex();
  // Re-index existing
  for (const c of page.characters) {
    spatial.insert({ id: c.id, type: 'character', bbox: c.bbox, zIndex: c.zIndex });
  }
  for (const img of page.images) {
    spatial.insert({ id: img.id, type: 'image', bbox: img.bbox, zIndex: img.zIndex });
  }
  for (const v of page.vectors) {
    spatial.insert({ id: v.id, type: 'vector', bbox: v.bbox, zIndex: v.zIndex });
  }

  const injected: RawCharacter[] = ocrChars.map((c, i) => {
    const id = `ocr_char_${page.index}_${i}`;
    const fontSize = c.fontSize ?? c.bbox.height;
    const character: RawCharacter = {
      id,
      type: 'character',
      parentId: page.id,
      childIds: [],
      pageIndex: page.index,
      bbox: { ...c.bbox },
      transform: [fontSize, 0, 0, fontSize, c.bbox.x, c.bbox.y],
      zIndex: 2000 + i,
      unicode: c.text,
      glyphId: c.text.codePointAt(0) ?? 0,
      width: c.bbox.width,
      height: c.bbox.height,
      rotation: 0,
      fontName: 'OCR-Estimated',
      fontSize,
      fontWeight: c.bold ? 700 : 400,
      italic: !!c.italic,
      fillColor: { space: 'DeviceGray', values: [0] },
      strokeColor: null,
      characterSpacing: 0,
      wordSpacing: 0,
      renderingMode: 0,
      writingDirection: 'ltr',
    };
    spatial.insert({ id, type: 'character', bbox: c.bbox, zIndex: 2000 + i });
    return character;
  });

  return {
    ...page,
    characters: [...page.characters, ...injected],
    spatialIndex: spatial,
  };
}

function overlapsParserText(
  bbox: { x: number; y: number; width: number; height: number },
  parserBlocks: RecognitionBlock[],
): boolean {
  for (const b of parserBlocks) {
    if (
      !(
        bbox.x + bbox.width < b.bbox.x ||
        b.bbox.x + b.bbox.width < bbox.x ||
        bbox.y + bbox.height < b.bbox.y ||
        b.bbox.y + b.bbox.height < bbox.y
      )
    ) {
      return true;
    }
  }
  return false;
}

function union(boxes: Array<{ x: number; y: number; width: number; height: number }>) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function avg(nums: number[]): number {
  if (!nums.length) return 0.5;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function majority(items: string[]): string | undefined {
  if (!items.length) return undefined;
  const counts = new Map<string, number>();
  for (const i of items) counts.set(i, (counts.get(i) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export function fuseRawDocument(
  raw: RawDocument,
  pages: RawPage[],
): RawDocument {
  return { ...raw, pages };
}
