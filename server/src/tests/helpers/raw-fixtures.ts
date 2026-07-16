import { ObjectGraph } from '../../engines/parser/object-graph.js';
import { PageSpatialIndex } from '../../engines/parser/spatial-index.js';
import type {
  RawCharacter,
  RawDocument,
  RawImage,
  RawPage,
} from '../../engines/parser/raw-model.js';

export interface CharSpec {
  ch: string;
  x: number;
  y: number;
  fontSize?: number;
  fontName?: string;
  fontWeight?: number;
  w?: number;
  /** Simulates the PDF text-showing run (Tj/TJ call) this character belongs to. */
  runId?: string;
}

export function buildRawDocument(pages: RawPage[], id = 'raw_test'): RawDocument {
  const graph = new ObjectGraph();
  for (const page of pages) {
    graph.add({
      id: page.id,
      type: 'page',
      parentId: id,
      childIds: [],
      pageIndex: page.index,
      bbox: { x: 0, y: 0, width: page.width, height: page.height },
      transform: [1, 0, 0, 1, 0, 0],
      zIndex: 0,
    });
  }
  return {
    id,
    metadata: { pdfVersion: '1.7', title: 'Fixture' },
    pages,
    bookmarks: [],
    objectGraph: graph,
    sourceBytes: 0,
  };
}

export function buildPage(opts: {
  index?: number;
  width?: number;
  height?: number;
  chars?: CharSpec[];
  images?: Array<{ x: number; y: number; w: number; h: number }>;
}): RawPage {
  const index = opts.index ?? 0;
  const width = opts.width ?? 612;
  const height = opts.height ?? 792;
  const pageId = `page_${index}`;
  const spatial = new PageSpatialIndex();

  const characters: RawCharacter[] = (opts.chars ?? []).map((spec, i) => {
    const fontSize = spec.fontSize ?? 12;
    const w = spec.w ?? fontSize * 0.55;
    const id = `char_${index}_${i}`;
    const bbox = { x: spec.x, y: spec.y, width: w, height: fontSize };
    const character: RawCharacter = {
      id,
      type: 'character',
      parentId: spec.runId ?? pageId,
      childIds: [],
      pageIndex: index,
      bbox,
      transform: [fontSize, 0, 0, fontSize, spec.x, spec.y],
      zIndex: i,
      unicode: spec.ch,
      glyphId: spec.ch.codePointAt(0) ?? 0,
      width: w,
      height: fontSize,
      rotation: 0,
      fontName: spec.fontName ?? 'Helvetica',
      fontSize,
      fontWeight: spec.fontWeight ?? 400,
      italic: false,
      fillColor: { space: 'DeviceGray', values: [0] },
      strokeColor: null,
      characterSpacing: 0,
      wordSpacing: 0,
      renderingMode: 0,
      writingDirection: 'ltr',
    };
    spatial.insert({ id, type: 'character', bbox, zIndex: i });
    return character;
  });

  const images: RawImage[] = (opts.images ?? []).map((img, i) => {
    const id = `img_${index}_${i}`;
    const bbox = { x: img.x, y: img.y, width: img.w, height: img.h };
    const image: RawImage = {
      id,
      type: 'image',
      parentId: pageId,
      childIds: [],
      pageIndex: index,
      bbox,
      transform: [1, 0, 0, 1, img.x, img.y],
      zIndex: 1000 + i,
      imageType: 'raw',
      widthPx: Math.round(img.w),
      heightPx: Math.round(img.h),
      dpi: 72,
      compression: null,
      colorSpace: 'DeviceRGB',
      hasTransparency: false,
      rotation: 0,
      resourceName: `Im${i}`,
    };
    spatial.insert({ id, type: 'image', bbox, zIndex: 1000 + i });
    return image;
  });

  return {
    id: pageId,
    index,
    width,
    height,
    rotation: 0,
    boxes: {
      mediaBox: { x: 0, y: 0, width, height },
      cropBox: { x: 0, y: 0, width, height },
      bleedBox: null,
      trimBox: null,
      artBox: null,
    },
    resources: {},
    characters,
    textRuns: [],
    words: [],
    images,
    vectors: [],
    annotations: [],
    forms: [],
    fonts: [],
    spatialIndex: spatial,
  };
}

let runSeq = 0;

/** Place a word as sequential characters on a baseline (one simulated text run). */
export function wordChars(
  text: string,
  x: number,
  y: number,
  fontSize = 12,
  fontName = 'Helvetica',
): CharSpec[] {
  const out: CharSpec[] = [];
  const runId = `run_${runSeq++}`;
  let cursor = x;
  for (const ch of text) {
    const w = fontSize * (ch === ' ' ? 0.3 : 0.55);
    out.push({ ch, x: cursor, y, fontSize, fontName, w, runId });
    cursor += w;
  }
  return out;
}

export function lineOfWords(
  words: string[],
  x: number,
  y: number,
  fontSize = 12,
): CharSpec[] {
  const out: CharSpec[] = [];
  let cursor = x;
  for (let i = 0; i < words.length; i++) {
    const part = wordChars(words[i]!, cursor, y, fontSize);
    out.push(...part);
    cursor = (part[part.length - 1]?.x ?? cursor) + (part[part.length - 1]?.w ?? fontSize) + fontSize * 0.35;
  }
  return out;
}
