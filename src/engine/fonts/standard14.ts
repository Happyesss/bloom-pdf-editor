/**
 * Standard 14 PDF Fonts — Built-in Metrics
 *
 * Every PDF viewer must support these 14 fonts without embedding.
 * This file contains glyph width tables (in 1/1000 units of font size)
 * for all 14 standard fonts.
 *
 * The widths are used for text layout when a PDF references these fonts
 * without embedding width information.
 */

export interface StandardFontMetrics {
  /** Font family name */
  name: string;
  /** Widths for character codes 0-255 (Latin-1) in 1/1000 units */
  widths: number[];
  /** Default width for missing characters */
  defaultWidth: number;
  /** Ascent above baseline in 1/1000 units */
  ascent: number;
  /** Descent below baseline in 1/1000 units (negative) */
  descent: number;
  /** Is this font monospaced? */
  isMonospace: boolean;
  /** Is this font serif? */
  isSerif: boolean;
  /** CSS font-family string for rendering */
  cssFamily: string;
  /** Is bold */
  isBold: boolean;
  /** Is italic */
  isItalic: boolean;
}

// ─── Helvetica widths (standard sans-serif, equivalent to Arial) ────────

const HELVETICA_WIDTHS: number[] = new Array(256).fill(278);
// Space and basic ASCII
const HW: Record<number, number> = {
  32:278, 33:278, 34:355, 35:556, 36:556, 37:889, 38:667, 39:191,
  40:333, 41:333, 42:389, 43:584, 44:278, 45:333, 46:278, 47:278,
  48:556, 49:556, 50:556, 51:556, 52:556, 53:556, 54:556, 55:556,
  56:556, 57:556, 58:278, 59:278, 60:584, 61:584, 62:584, 63:556,
  64:1015, 65:667, 66:667, 67:722, 68:722, 69:667, 70:611, 71:778,
  72:722, 73:278, 74:500, 75:667, 76:556, 77:833, 78:722, 79:778,
  80:667, 81:778, 82:722, 83:667, 84:611, 85:722, 86:667, 87:944,
  88:667, 89:667, 90:611, 91:278, 92:278, 93:278, 94:469, 95:556,
  96:333, 97:556, 98:556, 99:500, 100:556, 101:556, 102:278, 103:556,
  104:556, 105:222, 106:222, 107:500, 108:222, 109:833, 110:556, 111:556,
  112:556, 113:556, 114:333, 115:500, 116:278, 117:556, 118:500, 119:722,
  120:500, 121:500, 122:500, 123:334, 124:260, 125:334, 126:584,
};
Object.entries(HW).forEach(([k, v]) => { HELVETICA_WIDTHS[Number(k)] = v; });

// ─── Helvetica-Bold widths ──────────────────────────────────────────────

const HELVETICA_BOLD_WIDTHS: number[] = new Array(256).fill(278);
const HBW: Record<number, number> = {
  32:278, 33:333, 34:474, 35:556, 36:556, 37:889, 38:722, 39:238,
  40:333, 41:333, 42:389, 43:584, 44:278, 45:333, 46:278, 47:278,
  48:556, 49:556, 50:556, 51:556, 52:556, 53:556, 54:556, 55:556,
  56:556, 57:556, 58:333, 59:333, 60:584, 61:584, 62:584, 63:611,
  64:975, 65:722, 66:722, 67:722, 68:722, 69:667, 70:611, 71:778,
  72:722, 73:278, 74:556, 75:722, 76:611, 77:833, 78:722, 79:778,
  80:667, 81:778, 82:722, 83:667, 84:611, 85:722, 86:667, 87:944,
  88:667, 89:667, 90:611, 91:333, 92:278, 93:333, 94:584, 95:556,
  96:333, 97:556, 98:611, 99:556, 100:611, 101:556, 102:333, 103:611,
  104:611, 105:278, 106:278, 107:556, 108:278, 109:889, 110:611, 111:611,
  112:611, 113:611, 114:389, 115:556, 116:333, 117:611, 118:556, 119:778,
  120:556, 121:556, 122:500, 123:389, 124:280, 125:389, 126:584,
};
Object.entries(HBW).forEach(([k, v]) => { HELVETICA_BOLD_WIDTHS[Number(k)] = v; });

// ─── Times-Roman widths (standard serif) ────────────────────────────────

const TIMES_ROMAN_WIDTHS: number[] = new Array(256).fill(250);
const TRW: Record<number, number> = {
  32:250, 33:333, 34:408, 35:500, 36:500, 37:833, 38:778, 39:180,
  40:333, 41:333, 42:500, 43:564, 44:250, 45:333, 46:250, 47:278,
  48:500, 49:500, 50:500, 51:500, 52:500, 53:500, 54:500, 55:500,
  56:500, 57:500, 58:278, 59:278, 60:564, 61:564, 62:564, 63:444,
  64:921, 65:722, 66:667, 67:667, 68:722, 69:611, 70:556, 71:722,
  72:722, 73:333, 74:389, 75:722, 76:611, 77:889, 78:722, 79:722,
  80:556, 81:722, 82:667, 83:556, 84:611, 85:722, 86:722, 87:944,
  88:722, 89:722, 90:611, 91:333, 92:278, 93:333, 94:469, 95:500,
  96:333, 97:444, 98:500, 99:444, 100:500, 101:444, 102:333, 103:500,
  104:500, 105:278, 106:278, 107:500, 108:278, 109:778, 110:500, 111:500,
  112:500, 113:500, 114:333, 115:389, 116:278, 117:500, 118:500, 119:722,
  120:500, 121:500, 122:444, 123:480, 124:200, 125:480, 126:541,
};
Object.entries(TRW).forEach(([k, v]) => { TIMES_ROMAN_WIDTHS[Number(k)] = v; });

// ─── Courier widths (monospace — all glyphs are 600) ────────────────────

const COURIER_WIDTHS: number[] = new Array(256).fill(600);

// ─── Standard 14 fonts registry ─────────────────────────────────────────

const STANDARD_FONTS: Record<string, StandardFontMetrics> = {
  'Helvetica': {
    name: 'Helvetica', widths: HELVETICA_WIDTHS, defaultWidth: 278,
    ascent: 718, descent: -207, isMonospace: false, isSerif: false,
    cssFamily: 'Helvetica, Arial, sans-serif', isBold: false, isItalic: false,
  },
  'Helvetica-Bold': {
    name: 'Helvetica-Bold', widths: HELVETICA_BOLD_WIDTHS, defaultWidth: 278,
    ascent: 718, descent: -207, isMonospace: false, isSerif: false,
    cssFamily: 'Helvetica, Arial, sans-serif', isBold: true, isItalic: false,
  },
  'Helvetica-Oblique': {
    name: 'Helvetica-Oblique', widths: HELVETICA_WIDTHS, defaultWidth: 278,
    ascent: 718, descent: -207, isMonospace: false, isSerif: false,
    cssFamily: 'Helvetica, Arial, sans-serif', isBold: false, isItalic: true,
  },
  'Helvetica-BoldOblique': {
    name: 'Helvetica-BoldOblique', widths: HELVETICA_BOLD_WIDTHS, defaultWidth: 278,
    ascent: 718, descent: -207, isMonospace: false, isSerif: false,
    cssFamily: 'Helvetica, Arial, sans-serif', isBold: true, isItalic: true,
  },
  'Times-Roman': {
    name: 'Times-Roman', widths: TIMES_ROMAN_WIDTHS, defaultWidth: 250,
    ascent: 683, descent: -217, isMonospace: false, isSerif: true,
    cssFamily: '"Times New Roman", Times, serif', isBold: false, isItalic: false,
  },
  'Times-Bold': {
    name: 'Times-Bold', widths: TIMES_ROMAN_WIDTHS, defaultWidth: 250,
    ascent: 683, descent: -217, isMonospace: false, isSerif: true,
    cssFamily: '"Times New Roman", Times, serif', isBold: true, isItalic: false,
  },
  'Times-Italic': {
    name: 'Times-Italic', widths: TIMES_ROMAN_WIDTHS, defaultWidth: 250,
    ascent: 683, descent: -217, isMonospace: false, isSerif: true,
    cssFamily: '"Times New Roman", Times, serif', isBold: false, isItalic: true,
  },
  'Times-BoldItalic': {
    name: 'Times-BoldItalic', widths: TIMES_ROMAN_WIDTHS, defaultWidth: 250,
    ascent: 683, descent: -217, isMonospace: false, isSerif: true,
    cssFamily: '"Times New Roman", Times, serif', isBold: true, isItalic: true,
  },
  'Courier': {
    name: 'Courier', widths: COURIER_WIDTHS, defaultWidth: 600,
    ascent: 629, descent: -157, isMonospace: true, isSerif: true,
    cssFamily: '"Courier New", Courier, monospace', isBold: false, isItalic: false,
  },
  'Courier-Bold': {
    name: 'Courier-Bold', widths: COURIER_WIDTHS, defaultWidth: 600,
    ascent: 629, descent: -157, isMonospace: true, isSerif: true,
    cssFamily: '"Courier New", Courier, monospace', isBold: true, isItalic: false,
  },
  'Courier-Oblique': {
    name: 'Courier-Oblique', widths: COURIER_WIDTHS, defaultWidth: 600,
    ascent: 629, descent: -157, isMonospace: true, isSerif: true,
    cssFamily: '"Courier New", Courier, monospace', isBold: false, isItalic: true,
  },
  'Courier-BoldOblique': {
    name: 'Courier-BoldOblique', widths: COURIER_WIDTHS, defaultWidth: 600,
    ascent: 629, descent: -157, isMonospace: true, isSerif: true,
    cssFamily: '"Courier New", Courier, monospace', isBold: true, isItalic: true,
  },
  'Symbol': {
    name: 'Symbol', widths: HELVETICA_WIDTHS, defaultWidth: 250,
    ascent: 1010, descent: -293, isMonospace: false, isSerif: false,
    cssFamily: 'Symbol, serif', isBold: false, isItalic: false,
  },
  'ZapfDingbats': {
    name: 'ZapfDingbats', widths: HELVETICA_WIDTHS, defaultWidth: 278,
    ascent: 820, descent: -143, isMonospace: false, isSerif: false,
    cssFamily: '"Zapf Dingbats", serif', isBold: false, isItalic: false,
  },
};

// ─── Lookup functions ───────────────────────────────────────────────────────

/**
 * Get metrics for a standard PDF font by name.
 * Handles common aliases and subset prefixes (e.g., "BCDEAF+Helvetica").
 */
export function getStandardFont(fontName: string): StandardFontMetrics | null {
  // Direct lookup
  if (STANDARD_FONTS[fontName]) return STANDARD_FONTS[fontName];

  // Strip subset prefix (6 uppercase letters + '+')
  const stripped = fontName.replace(/^[A-Z]{6}\+/, '');
  if (STANDARD_FONTS[stripped]) return STANDARD_FONTS[stripped];

  // Try common aliases
  const aliases: Record<string, string> = {
    'ArialMT': 'Helvetica',
    'Arial': 'Helvetica',
    'Arial-BoldMT': 'Helvetica-Bold',
    'Arial-ItalicMT': 'Helvetica-Oblique',
    'Arial-BoldItalicMT': 'Helvetica-BoldOblique',
    'TimesNewRomanPSMT': 'Times-Roman',
    'TimesNewRomanPS-BoldMT': 'Times-Bold',
    'TimesNewRomanPS-ItalicMT': 'Times-Italic',
    'TimesNewRomanPS-BoldItalicMT': 'Times-BoldItalic',
    'CourierNewPSMT': 'Courier',
    'CourierNewPS-BoldMT': 'Courier-Bold',
    'CourierNewPS-ItalicMT': 'Courier-Oblique',
    'CourierNewPS-BoldItalicMT': 'Courier-BoldOblique',
  };

  const aliased = aliases[stripped];
  if (aliased && STANDARD_FONTS[aliased]) return STANDARD_FONTS[aliased];

  // Fuzzy match based on font name patterns
  const lower = stripped.toLowerCase();
  if (lower.includes('courier') || lower.includes('mono')) {
    if (lower.includes('bold') && lower.includes('italic')) return STANDARD_FONTS['Courier-BoldOblique'];
    if (lower.includes('bold')) return STANDARD_FONTS['Courier-Bold'];
    if (lower.includes('italic') || lower.includes('oblique')) return STANDARD_FONTS['Courier-Oblique'];
    return STANDARD_FONTS['Courier'];
  }
  if (lower.includes('times') || lower.includes('roman')) {
    if (lower.includes('bold') && lower.includes('italic')) return STANDARD_FONTS['Times-BoldItalic'];
    if (lower.includes('bold')) return STANDARD_FONTS['Times-Bold'];
    if (lower.includes('italic')) return STANDARD_FONTS['Times-Italic'];
    return STANDARD_FONTS['Times-Roman'];
  }
  if (lower.includes('helv') || lower.includes('arial') || lower.includes('sans')) {
    if (lower.includes('bold') && (lower.includes('italic') || lower.includes('oblique'))) return STANDARD_FONTS['Helvetica-BoldOblique'];
    if (lower.includes('bold')) return STANDARD_FONTS['Helvetica-Bold'];
    if (lower.includes('italic') || lower.includes('oblique')) return STANDARD_FONTS['Helvetica-Oblique'];
    return STANDARD_FONTS['Helvetica'];
  }
  if (lower.includes('symbol')) return STANDARD_FONTS['Symbol'];
  if (lower.includes('zapf') || lower.includes('dingbat')) return STANDARD_FONTS['ZapfDingbats'];

  return null;
}

/**
 * Get the CSS font-family string that best matches a PDF font name.
 * Used by the renderer for canvas fillText.
 */
export function getCSSFontFamily(fontName: string): string {
  const std = getStandardFont(fontName);
  if (std) return std.cssFamily;

  // For unknown fonts, try to map to a reasonable CSS family
  const stripped = fontName.replace(/^[A-Z]{6}\+/, '').replace(/[-,](Bold|Italic|Regular|Light|Medium|Oblique)/gi, '');
  return `"${stripped}", sans-serif`;
}

/**
 * Get the width of a character in a standard font.
 * Returns width in 1/1000 units of font size.
 */
export function getStandardFontCharWidth(fontName: string, charCode: number): number {
  const std = getStandardFont(fontName);
  if (!std) return 600;
  if (charCode < 0 || charCode >= std.widths.length) return std.defaultWidth;
  return std.widths[charCode] || std.defaultWidth;
}
