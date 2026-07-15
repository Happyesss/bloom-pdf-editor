import { describe, it, expect } from 'vitest';
import { createContainer } from '../container.js';
import { RecognitionFusionEngine } from '../engines/ocr/engine.js';
import { SyntheticOcrProvider } from '../engines/ocr/providers.js';
import { classifyPage } from '../engines/ocr/classify.js';
import {
  buildPage,
  buildRawDocument,
  wordChars,
} from './helpers/raw-fixtures.js';

describe('Phase 10 — OCR & Recognition Fusion', () => {
  it('classifies digital vs scanned pages', () => {
    const digital = buildPage({
      chars: wordChars('Plenty of digital text on this page here', 72, 500, 12),
    });
    expect(classifyPage(digital).kind).toBe('digital');
    expect(classifyPage(digital).needsOcr).toBe(false);

    const scanned = buildPage({
      chars: [],
      images: [{ x: 0, y: 0, w: 600, h: 780 }],
    });
    const cls = classifyPage(scanned);
    expect(['scanned', 'photo', 'fax']).toContain(cls.kind);
    expect(cls.needsOcr).toBe(true);
  });

  it('fuses synthetic OCR text into scanned pages without duplicating parser text', async () => {
    const page = buildPage({
      chars: [],
      images: [{ x: 36, y: 36, w: 540, h: 720 }],
    });
    const raw = buildRawDocument([page]);
    const engine = new RecognitionFusionEngine({
      provider: new SyntheticOcrProvider([
        { pageIndex: 0, text: 'Invoice Total Due', y: 700 },
        { pageIndex: 0, text: 'Amount 42.00', y: 680 },
      ]),
    });

    const result = await engine.GenerateRecognitionModel(raw);
    expect(result.recognition.pages[0]?.ocrApplied).toBe(true);
    expect(result.raw.pages[0]!.characters.length).toBeGreaterThan(0);
    expect(result.recognition.pages[0]!.blocks.some((b) => /Invoice/.test(b.text))).toBe(true);

    // Prefer parser when present — digital page should not OCR-inject over text
    const digital = buildRawDocument([
      buildPage({ chars: wordChars('Parser text already here', 72, 500, 12) }),
    ]);
    const dig = await engine.fuse(digital);
    expect(dig.recognition.pages[0]?.kind).toBe('digital');
  });

  it('exposes AnalyzePage / RunOCR / MergeRecognition / EstimateFonts APIs', async () => {
    const page = buildPage({
      chars: [],
      images: [{ x: 0, y: 0, w: 612, h: 792 }],
    });
    const engine = new RecognitionFusionEngine({
      provider: new SyntheticOcrProvider([{ pageIndex: 0, text: 'Hello OCR' }]),
    });
    const cls = engine.AnalyzePage(page);
    expect(cls.needsOcr).toBe(true);
    const ocr = await engine.RunOCR(page);
    expect(ocr.blocks.length).toBeGreaterThanOrEqual(1);
    const merged = engine.MergeRecognition(page, cls, ocr);
    expect(merged.recognition.characters.length).toBeGreaterThan(0);
    const fonts = engine.EstimateFonts(merged.recognition);
    expect(fonts.length).toBeGreaterThan(0);
  });

  it('does not emit DOCX/XLSX artifacts', async () => {
    const raw = buildRawDocument([buildPage({ chars: wordChars('x', 72, 400, 12) })]);
    const result = await new RecognitionFusionEngine().fuse(raw);
    expect(JSON.stringify(result.recognition)).not.toMatch(/docx|xlsx|spreadsheetml/i);
  });

  it('container exposes recognition fusion engine', () => {
    const c = createContainer({
      memoryStorage: true,
      configOverrides: { 'telemetry.enabled': false },
    });
    expect(c.ocr.name).toBe('RecognitionFusionEngine');
  });
});
