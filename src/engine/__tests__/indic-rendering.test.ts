import { describe, it, expect } from 'vitest';
import {
  reorderPreBaseVowels,
  normalizeIndicText,
  isIndicCombiningChar,
  isDevanagariChar,
  isLegacyIndicFont,
  convertKrutiDevToUnicode,
  reorderIndicGlyphs,
  repairIndicRuns,
} from '../fonts/indic-normalizer';

describe('Indic & Devanagari Normalization', () => {
  describe('reorderPreBaseVowels', () => {
    it('reorders pre-base vowel sign ि (U+093F) to after the consonant', () => {
      // Visual order: ि + प + त + ा
      const visual = '\u093F\u092A\u0924\u093E';
      expect(reorderPreBaseVowels(visual)).toBe('पिता');
    });

    it('reorders pre-base vowel sign with a consonant cluster (conjunct)', () => {
      // Visual order: ि + क + ् + ष
      const visual = '\u093F\u0915\u094D\u0937';
      expect(reorderPreBaseVowels(visual)).toBe('क्षि');
    });

    it('cleans dotted circles before pre-base vowel signs', () => {
      // ◌ि पता
      const input = '\u25CC\u093F पता';
      expect(reorderPreBaseVowels(input)).toBe('पिता');
    });

    it('cleans dotted circles between consonant and matra', () => {
      // क + ◌ + ृ + त
      const input = 'क\u25CC\u0943त';
      expect(reorderPreBaseVowels(input)).toBe('कृत');
    });
  });

  describe('normalizeIndicText (User Screenshot Cases)', () => {
    it('fixes "◌ि पता/पित का नाम" and "फ्ता/पित का नाम" to "पिता / पति का नाम"', () => {
      expect(normalizeIndicText('\u25CCि पता/पित का नाम')).toBe('पिता / पति का नाम');
      expect(normalizeIndicText('फ्ता/पित का नाम')).toBe('पिता / पति का नाम');
    });

    it('fixes "समाटरमीटर" to "स्मार्ट मीटर"', () => {
      const input = 'समाटरमीटर पर दजर मोबाइल';
      const output = normalizeIndicText(input);
      expect(output).toBe('स्मार्ट मीटर पर दर्ज मोबाइल');
    });

    it('fixes "ई-के वाईसी", "ई-क◌्रवाईसी" and "ई-क्रवाईसी" to "ई-केवाईसी"', () => {
      expect(normalizeIndicText('ई-के वाईसी')).toBe('ई-केवाईसी');
      expect(normalizeIndicText('ई-क\u25CC्रवाईसी')).toBe('ई-केवाईसी');
      expect(normalizeIndicText('ई-क्रवाईसी')).toBe('ई-केवाईसी');
    });

    it('fixes "पंजीक◌ृत मोबाइल" and "पंजीकृ त" to "पंजीकृत मोबाइल"', () => {
      expect(normalizeIndicText('पंजीक\u25CCृत मोबाइल न०')).toBe('पंजीकृत मोबाइल न०');
      expect(normalizeIndicText('पंजीकृ त मोबाइल न०')).toBe('पंजीकृत मोबाइल न०');
    });

    it('fixes "ब्नि संख्या", "ब्लि माह", "ब्लि तिथि" to "बिल संख्या", "बिल माह", "बिल तिथि"', () => {
      expect(normalizeIndicText('ब्नि संख्या / Bill No')).toBe('बिल संख्या / Bill No');
      expect(normalizeIndicText('ब्लि माह / Bill Month')).toBe('बिल माह / Bill Month');
      expect(normalizeIndicText('ब्लि तिथि/ Bill Date')).toBe('बिल तिथि/ Bill Date');
    });

    it('fixes "अकाउं◌ं सं." and "अकाउंटं सं." to "अकाउंट सं."', () => {
      expect(normalizeIndicText('अकाउं\u25CCं सं.')).toBe('अकाउंट सं.');
      expect(normalizeIndicText('अकाउंटं सं.')).toBe('अकाउंट सं.');
    });
  });

  describe('isIndicCombiningChar', () => {
    it('identifies Devanagari matras and virama as combining marks', () => {
      expect(isIndicCombiningChar('\u093E')).toBe(true); // ा
      expect(isIndicCombiningChar('\u093F')).toBe(true); // ि
      expect(isIndicCombiningChar('\u0940')).toBe(true); // ी
      expect(isIndicCombiningChar('\u0941')).toBe(true); // ु
      expect(isIndicCombiningChar('\u0942')).toBe(true); // ू
      expect(isIndicCombiningChar('\u0943')).toBe(true); // ृ
      expect(isIndicCombiningChar('\u0947')).toBe(true); // े
      expect(isIndicCombiningChar('\u0948')).toBe(true); // ै
      expect(isIndicCombiningChar('\u094B')).toBe(true); // ो
      expect(isIndicCombiningChar('\u094C')).toBe(true); // ौ
      expect(isIndicCombiningChar('\u094D')).toBe(true); // ् virama
      expect(isIndicCombiningChar('\u0902')).toBe(true); // ं anusvara
      expect(isIndicCombiningChar('\u25CC')).toBe(true); // ◌ dotted circle
    });

    it('identifies standard consonants and Latin letters as non-combining', () => {
      expect(isIndicCombiningChar('क')).toBe(false);
      expect(isIndicCombiningChar('प')).toBe(false);
      expect(isIndicCombiningChar('A')).toBe(false);
      expect(isIndicCombiningChar(' ')).toBe(false);
    });
  });

  describe('Legacy Hindi Font Converter (Kruti Dev / DevLys)', () => {
    it('detects legacy Indic font names', () => {
      expect(isLegacyIndicFont('KrutiDev010')).toBe(true);
      expect(isLegacyIndicFont('DevLys 010')).toBe(true);
      expect(isLegacyIndicFont('Walkman-Chanakya-901')).toBe(true);
      expect(isLegacyIndicFont('Shusha02')).toBe(true);
      expect(isLegacyIndicFont('Helvetica')).toBe(false);
      expect(isLegacyIndicFont('TimesNewRoman')).toBe(false);
    });

    it('converts Kruti Dev ASCII strings to Unicode Devanagari', () => {
      // 'firk' in Kruti Dev is 'पिता'
      expect(convertKrutiDevToUnicode('firk')).toBe('पिता');
      // 'ntZ' in Kruti Dev is 'दर्ज'
      expect(convertKrutiDevToUnicode('ntZ')).toBe('दर्ज');
      // 'LekVZ' in Kruti Dev is 'स्मार्ट'
      expect(convertKrutiDevToUnicode('LekVZ')).toBe('स्मार्ट');
    });
  });

  describe('reorderIndicGlyphs & repairIndicRuns', () => {
    it('reorders glyph array objects to match logical Unicode order', () => {
      const dummyTRm = { a: 12, b: 0, c: 0, d: 12, e: 100, f: 200 };
      const glyphs = [
        { charCode: 0x66, unicode: '\u093F', x: 100, y: 200, width: 4, fontSize: 12, tRm: dummyTRm },
        { charCode: 0x69, unicode: 'प', x: 104, y: 200, width: 8, fontSize: 12, tRm: dummyTRm },
        { charCode: 0x72, unicode: 'त', x: 112, y: 200, width: 8, fontSize: 12, tRm: dummyTRm },
        { charCode: 0x6B, unicode: 'ा', x: 120, y: 200, width: 4, fontSize: 12, tRm: dummyTRm },
      ];

      const reordered = reorderIndicGlyphs(glyphs);
      expect(reordered.map(g => g.unicode).join('')).toBe('पिता');
      expect(reordered[0].unicode).toBe('प');
      expect(reordered[1].unicode).toBe('\u093F');
    });

    it('repairs entire text runs with Indic text', () => {
      const dummyTRm = { a: 12, b: 0, c: 0, d: 12, e: 100, f: 200 };
      const runs = [
        {
          text: '\u25CCि पता/पित का नाम',
          glyphs: [
            { charCode: 0, unicode: '\u25CC', x: 95, y: 200, width: 0, fontSize: 12, tRm: dummyTRm },
            { charCode: 1, unicode: '\u093F', x: 100, y: 200, width: 4, fontSize: 12, tRm: dummyTRm },
            { charCode: 2, unicode: ' ', x: 104, y: 200, width: 4, fontSize: 12, tRm: dummyTRm },
            { charCode: 3, unicode: 'प', x: 108, y: 200, width: 8, fontSize: 12, tRm: dummyTRm },
            { charCode: 4, unicode: 'त', x: 116, y: 200, width: 8, fontSize: 12, tRm: dummyTRm },
            { charCode: 5, unicode: 'ा', x: 124, y: 200, width: 4, fontSize: 12, tRm: dummyTRm },
          ],
        },
      ];

      repairIndicRuns(runs);
      expect(runs[0].text).toContain('पिता');
    });
  });
});
