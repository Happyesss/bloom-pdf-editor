import { createId } from '../../utils/id.js';
import type { RawDocument, RawPage } from '../parser/raw-model.js';
import { classifyPage, type PageClassification } from './classify.js';
import {
  buildRecognitionDocument,
  fuseRawDocument,
  mergeRecognition,
} from './fusion.js';
import { estimateFonts } from './fonts.js';
import { detectLanguage } from './language.js';
import { planPreprocess } from './preprocess.js';
import { NullOcrProvider } from './providers.js';
import type {
  IOcrProvider,
  RecognitionFusionResult,
  RecognitionPage,
} from './types.js';

export interface RecognitionFusionEngineOptions {
  provider?: IOcrProvider;
  /** Force OCR even on digital pages (tests). */
  forceOcr?: boolean;
  languages?: string[];
  concurrency?: number;
}

/**
 * Phase 10 — OCR & Recognition Fusion Engine.
 * Produces RecognitionDocument and a fused RawDocument. No export.
 */
export class RecognitionFusionEngine {
  readonly name = 'RecognitionFusionEngine' as const;
  private readonly provider: IOcrProvider;
  private readonly forceOcr: boolean;
  private readonly languages: string[];
  private readonly concurrency: number;

  constructor(options: RecognitionFusionEngineOptions = {}) {
    this.provider = options.provider ?? new NullOcrProvider();
    this.forceOcr = options.forceOcr ?? false;
    this.languages = options.languages ?? ['en'];
    this.concurrency = options.concurrency ?? 4;
  }

  /** Worker entry — fuse OCR into raw for downstream layout/IDM. */
  async process(raw: RawDocument): Promise<RawDocument> {
    const result = await this.GenerateRecognitionModel(raw);
    return result.raw;
  }

  /** Full fusion result including RecognitionDocument. */
  async fuse(raw: RawDocument): Promise<RecognitionFusionResult> {
    return this.GenerateRecognitionModel(raw);
  }

  AnalyzePage(page: RawPage): PageClassification {
    return classifyPage(page);
  }

  async RunOCR(page: RawPage): Promise<Awaited<ReturnType<IOcrProvider['recognize']>>> {
    const classification = classifyPage(page);
    const plan = planPreprocess({
      kind: classification.kind,
      rotation: page.rotation,
    });
    void plan;
    const largest = page.images.reduce<(typeof page.images)[0] | null>((best, img) => {
      if (!best) return img;
      return img.bbox.width * img.bbox.height > best.bbox.width * best.bbox.height ? img : best;
    }, null);

    return this.provider.recognize({
      pageIndex: page.index,
      width: page.width,
      height: page.height,
      imageBytes: largest?.data,
      languages: this.languages,
    });
  }

  MergeRecognition(
    page: RawPage,
    classification: PageClassification,
    ocr: Awaited<ReturnType<IOcrProvider['recognize']>> | null,
  ) {
    return mergeRecognition(page, classification, ocr);
  }

  EstimateFonts(page: RecognitionPage) {
    return page.blocks.map((b) => {
      const words = page.words.filter((w) => b.wordIds.includes(w.id));
      return estimateFonts(words, b);
    });
  }

  async GenerateRecognitionModel(raw: RawDocument): Promise<RecognitionFusionResult> {
    const fusedPages: RawPage[] = [];
    const recogPages: RecognitionPage[] = [];

    // Simple concurrency pool
    const queue = [...raw.pages];
    const workers: Promise<void>[] = [];
    const results = new Map<number, { page: RawPage; recognition: RecognitionPage }>();

    const runOne = async (page: RawPage) => {
      const classification = this.AnalyzePage(page);
      let ocrResult = null;
      if (classification.needsOcr || this.forceOcr) {
        ocrResult = await this.RunOCR(page);
      }
      const merged = this.MergeRecognition(page, classification, ocrResult);
      results.set(page.index, merged);
    };

    while (queue.length || workers.length) {
      while (queue.length && workers.length < this.concurrency) {
        const page = queue.shift()!;
        const p = runOne(page).then(() => {
          const idx = workers.indexOf(p);
          if (idx >= 0) workers.splice(idx, 1);
        });
        workers.push(p);
      }
      if (workers.length) await Promise.race(workers);
    }

    for (const page of raw.pages) {
      const r = results.get(page.index)!;
      fusedPages.push(r.page);
      recogPages.push(r.recognition);
    }

    const recognition = buildRecognitionDocument(raw.id, recogPages);
    // Attach language guesses at document level
    const lang = detectLanguage(recogPages.flatMap((p) => p.blocks.map((b) => b.text)));
    recognition.primaryLanguage = recognition.primaryLanguage ?? lang.primary;
    recognition.secondaryLanguages = [
      ...new Set([...recognition.secondaryLanguages, ...lang.secondary]),
    ];

    return {
      id: createId('rfusion'),
      raw: fuseRawDocument(raw, fusedPages),
      recognition,
    };
  }
}

/** Back-compat alias used by DI / older imports. */
export { RecognitionFusionEngine as OCRManager };
