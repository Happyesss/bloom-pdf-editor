import { describe, it, expect } from 'vitest';
import { mapPdfFontToWord } from '../../app/editor/docx-flow-export';

describe('mapPdfFontToWord', () => {
  it('maps standard PDF fonts to Word families', () => {
    expect(mapPdfFontToWord('Helvetica')).toBe('Arial');
    expect(mapPdfFontToWord('Times-Bold')).toBe('Times New Roman');
    expect(mapPdfFontToWord('Courier-Oblique')).toBe('Courier New');
  });

  it('strips subset prefixes and style suffixes', () => {
    expect(mapPdfFontToWord('ABCDEF+Arial-BoldMT')).toBe('Arial');
    expect(mapPdfFontToWord('XYZABC+Calibri-Italic')).toBe('Calibri');
  });
});
