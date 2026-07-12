/**
 * Certificate / form PDF rendering regressions:
 * - apostrophe decoded as § from broken ToUnicode
 * - form label lines must not enter flow-draw
 * - Differences glyph names beat obscure ToUnicode symbols
 */

import { describe, it, expect } from 'vitest';
import { charCodeToUnicode, type FontData } from '../fonts/font-parser';
import { shouldUseFlowDraw, shouldPackLine } from '../flow';
import type { TextLine } from '../flow/types';
import type { TextRun, GlyphPosition } from '../content/interpreter';
import { identityMatrix } from '../render/graphics-state';

function makeFont(partial: Partial<FontData> & Pick<FontData, 'name' | 'baseFont'>): FontData {
  return {
    subtype: 'Type1',
    encoding: 'WinAnsiEncoding',
    isComposite: false,
    differences: new Map(),
    toUnicode: new Map(),
    widths: new Map(),
    defaultWidth: 500,
    ascent: 800,
    descent: -200,
    ...partial,
  };
}

function glyph(ch: string, x: number, fontSize = 12): GlyphPosition {
  const w = fontSize * 0.5;
  return {
    charCode: ch.charCodeAt(0),
    unicode: ch,
    x,
    y: 500,
    width: w,
    fontSize,
    textSpaceWidth: 0.5,
    tRm: { a: fontSize, b: 0, c: 0, d: fontSize, e: x, f: 500 },
  };
}

function lineFrom(text: string, fontSize = 12): TextLine {
  const glyphs = [...text].map((ch, i) => glyph(ch, 50 + i * fontSize * 0.5, fontSize));
  const run: TextRun = {
    type: 'text',
    text,
    glyphs,
    x: 50,
    y: 500,
    width: text.length * fontSize * 0.5,
    height: fontSize,
    fontName: 'F1',
    fontSize,
    textMatrix: identityMatrix(),
    fillColor: [0, 0, 0],
    fillAlpha: 1,
    blendMode: 'Normal',
    softMask: null,
    clipPaths: [],
  };
  return {
    id: 'l1',
    runs: [run],
    text,
    segments: [],
    baseline: 500,
    x: 50,
    y: 500,
    width: run.width,
    height: fontSize,
    leftMargin: 50,
    rightEdge: 50 + run.width,
    fontSize,
    isJustified: false,
    tabSplitIndex: -1,
  };
}

describe('charCodeToUnicode: certificate apostrophe', () => {
  it('prefers Differences quotesingle over ToUnicode section sign', () => {
    const font = makeFont({
      name: 'F1',
      baseFont: 'Times-Bold',
      differences: new Map([[0xa7, 'quotesingle']]),
      toUnicode: new Map([[0xa7, '\u00A7']]),
    });
    expect(charCodeToUnicode(0xa7, font)).toBe("'");
  });

  it('maps quote char codes away from obscure ToUnicode symbols', () => {
    const font = makeFont({
      name: 'F1',
      baseFont: 'Times-Roman',
      toUnicode: new Map([[0x27, '\u00A7']]),
    });
    expect(charCodeToUnicode(0x27, font)).toBe("'");
  });

  it('prefers quoteright over ToUnicode paragraph when both exist', () => {
    const font = makeFont({
      name: 'F1',
      baseFont: 'Times-Bold',
      differences: new Map([[0xb6, 'quoteright']]),
      toUnicode: new Map([[0xb6, '\u00B6']]),
    });
    expect(charCodeToUnicode(0xb6, font)).toBe('\u2019');
  });

  it('maps Differences section name through AGL (repair happens at interpret)', () => {
    const font = makeFont({
      name: 'F1',
      baseFont: 'Times-Bold',
      differences: new Map([[0xa7, 'section']]),
    });
    // Raw mapping stays §; lone/mid-word repair in interpreter converts to '
    expect(charCodeToUnicode(0xa7, font)).toBe('\u00A7');
  });
});

describe('flow-draw: certificate form rows', () => {
  it('does not pack INSTITUTE NAME / FATHER\'S NAME label lines', () => {
    const institute = lineFrom('INSTITUTE NAME: J.S.S. ACADEMY OF TECHNICAL EDUCATION,GAUTAM BUDDH NAGAR');
    expect(shouldUseFlowDraw(institute)).toBe(false);
    expect(shouldPackLine(institute)).toBe(false);

    const father = lineFrom("FATHER'S NAME: DHIRENDRA KUMAR SINGH");
    expect(shouldUseFlowDraw(father)).toBe(false);
    expect(shouldPackLine(father)).toBe(false);
  });
});
