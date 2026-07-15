import type { BoundingBox } from '../common/geometry.js';
import type { RawDocument } from '../parser/raw-model.js';

/** Phase 10 — OCR & Recognition Fusion (no export). */

export type PageContentKind =
  | 'digital'
  | 'scanned'
  | 'hybrid'
  | 'photo'
  | 'fax'
  | 'mixed';

export type TextScript = 'latin' | 'cjk' | 'arabic' | 'devanagari' | 'symbol' | 'math' | 'unknown';
export type WritingDir = 'ltr' | 'rtl' | 'ttb';
export type TextPrintKind = 'printed' | 'handwritten' | 'mixed' | 'unknown';

export interface ImageRegionHint {
  id: string;
  kind: 'text' | 'graphics' | 'table' | 'photo' | 'signature' | 'logo' | 'barcode' | 'qr' | 'unknown';
  bbox: BoundingBox;
  confidence: number;
}

export interface RecognitionCharacter {
  id: string;
  text: string;
  bbox: BoundingBox;
  confidence: number;
  fontSize?: number;
  bold?: boolean;
  italic?: boolean;
  source: 'parser' | 'ocr';
}

export interface RecognitionWord {
  id: string;
  text: string;
  bbox: BoundingBox;
  confidence: number;
  characterIds: string[];
  source: 'parser' | 'ocr' | 'fused';
}

export interface RecognitionBlock {
  id: string;
  text: string;
  bbox: BoundingBox;
  confidence: number;
  wordIds: string[];
  printKind: TextPrintKind;
  language?: string;
  writingDirection: WritingDir;
  source: 'parser' | 'ocr' | 'fused';
}

export interface RecognitionPage {
  pageIndex: number;
  kind: PageContentKind;
  language?: string;
  script?: TextScript;
  writingDirection: WritingDir;
  blocks: RecognitionBlock[];
  words: RecognitionWord[];
  characters: RecognitionCharacter[];
  imageRegions: ImageRegionHint[];
  confidence: {
    page: number;
    character: number;
    word: number;
    paragraph: number;
  };
  ocrApplied: boolean;
}

export interface RecognitionDocument {
  id: string;
  sourceDocumentId: string;
  pages: RecognitionPage[];
  primaryLanguage?: string;
  secondaryLanguages: string[];
  quality: {
    character: number;
    word: number;
    paragraph: number;
    page: number;
    document: number;
  };
}

export interface RecognitionFusionResult {
  id: string;
  /** Raw document with OCR characters fused in (never duplicates parser text). */
  raw: RawDocument;
  recognition: RecognitionDocument;
}

export interface OcrProviderResult {
  pageIndex: number;
  language?: string;
  blocks: Array<{
    text: string;
    bbox: BoundingBox;
    confidence: number;
    words?: Array<{ text: string; bbox: BoundingBox; confidence: number }>;
  }>;
}

export interface IOcrProvider {
  readonly name: string;
  /**
   * Run OCR on a page image region. May return empty if unsupported.
   * Handwriting providers can plug in here.
   */
  recognize(input: {
    pageIndex: number;
    width: number;
    height: number;
    imageBytes?: Uint8Array;
    languages?: string[];
  }): Promise<OcrProviderResult>;
}
