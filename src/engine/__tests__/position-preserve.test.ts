/**
 * Position-preserving edit — changing one run must not move other runs.
 */

import { describe, it, expect } from 'vitest';
import { buildDocumentFlow } from '../flow/index';
import { applyLineTextEdit } from '../flow/flow-editor';
import { interpretPage } from '../content/interpreter';
import {
  PDFDict,
  PDFName,
  PDFNumber,
  PDFRef,
  PDFArray,
  type PDFPageInfo,
  type PDFObject,
} from '../types';

function makePage(): { page: PDFPageInfo; objects: Map<string, PDFObject>; bytes: Uint8Array } {
  const content =
    'BT\n/F1 12 Tf\n1 0 0 1 50 700 Tm\n(Hello World) Tj\nET\n' +
    'BT\n/F1 12 Tf\n1 0 0 1 50 680 Tm\n(Second Line) Tj\nET\n';
  const bytes = new TextEncoder().encode(content);

  const fontDict = new PDFDict();
  const helv = new PDFDict();
  helv.set('Type', new PDFName('Font'));
  helv.set('Subtype', new PDFName('Type1'));
  helv.set('BaseFont', new PDFName('Helvetica'));
  fontDict.set('F1', helv);

  const resources = new PDFDict();
  resources.set('Font', fontDict);

  const pageDict = new PDFDict();
  pageDict.set('Resources', resources);
  pageDict.set('MediaBox', new PDFArray([
    new PDFNumber(0), new PDFNumber(0), new PDFNumber(612), new PDFNumber(792),
  ]));

  const page: PDFPageInfo = {
    index: 0,
    dict: pageDict,
    mediaBox: { x: 0, y: 0, width: 612, height: 792 },
    cropBox: { x: 0, y: 0, width: 612, height: 792 },
    rotate: 0,
    ref: new PDFRef(1, 0),
    resources,
    contentRefs: [new PDFRef(2, 0)],
  };

  const objects = new Map<string, PDFObject>();
  objects.set('1 0', pageDict);

  return { page, objects, bytes };
}

describe('position-preserving line edit', () => {
  it('edits one line without moving the other line', () => {
    const { page, objects, bytes } = makePage();
    const before = interpretPage(bytes, page, objects);
    expect(before.textRuns.length).toBeGreaterThanOrEqual(2);

    const flow = buildDocumentFlow(before.textRuns);
    expect(flow.lines.length).toBeGreaterThanOrEqual(2);
    const line0 = flow.lines[0];

    const otherBaseline = flow.lines[1].baseline;
    const otherText = flow.lines[1].text;
    const otherX = flow.lines[1].x;

    const result = applyLineTextEdit(
      bytes,
      page,
      objects,
      line0,
      'Hello Brave World',
      flow,
    );

    const after = interpretPage(result.newContentBytes, page, objects);
    const afterFlow = buildDocumentFlow(after.textRuns);

    const edited = afterFlow.lines.find(l =>
      Math.abs(l.baseline - line0.baseline) < 2 && Math.abs(l.x - line0.x) < 5,
    );
    expect(edited?.text).toContain('Brave');

    const second = afterFlow.lines.find(l =>
      Math.abs(l.baseline - otherBaseline) < 2,
    );
    expect(second).toBeTruthy();
    expect(second!.text).toBe(otherText);
    expect(Math.abs(second!.x - otherX)).toBeLessThan(2);

    for (const line of afterFlow.lines) {
      expect(line.baseline).toBeGreaterThan(0);
      expect(line.baseline).toBeLessThan(800);
    }
  });

  it('keeps both lines when rewriting with same text', () => {
    const { page, objects, bytes } = makePage();
    const before = interpretPage(bytes, page, objects);
    const flow = buildDocumentFlow(before.textRuns);
    const line = flow.lines[0];
    const result = applyLineTextEdit(bytes, page, objects, line, line.text, flow);
    const after = interpretPage(result.newContentBytes, page, objects);
    expect(after.textRuns.some(r => r.text.includes('Hello'))).toBe(true);
    expect(after.textRuns.some(r => r.text.includes('Second'))).toBe(true);
  });
});
