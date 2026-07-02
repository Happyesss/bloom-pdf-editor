/**
 * CMap Parser — Character Code to Unicode Mapping
 *
 * Parses CMap streams used by PDF fonts to map character codes (glyph IDs)
 * to Unicode code points. CMaps are essential for text extraction from PDFs
 * that use CID fonts (CJK languages, custom encodings, subset fonts).
 *
 * Supports:
 *   - beginbfchar / endbfchar sections (direct char→unicode mappings)
 *   - beginbfrange / endbfrange sections (range-based mappings)
 *   - begincodespacerange / endcodespacerange (byte width determination)
 *   - begincidchar / endcidchar (char→CID mappings)
 *   - begincidrange / endcidrange (range-based CID mappings)
 *   - Multi-byte character codes (1-4 bytes)
 */

// ─── CMap data structure ────────────────────────────────────────────────────

export interface CMapData {
  /** Character code → Unicode string mapping */
  toUnicode: Map<number, string>;
  /** Character code → CID mapping (for CIDFont) */
  toCID: Map<number, number>;
  /** Code space ranges: [low, high] pairs defining valid byte ranges */
  codeSpaceRanges: Array<{ low: number; high: number; bytes: number }>;
  /** CMap name (from /CMapName if present) */
  name: string;
  /** Writing mode: 0 = horizontal, 1 = vertical */
  writingMode: number;
}

// ─── Main parser ────────────────────────────────────────────────────────────

/**
 * Parse a CMap stream (raw bytes) into a CMapData structure.
 */
export function parseCMap(data: Uint8Array): CMapData {
  const text = bytesToLatin1(data);
  const result: CMapData = {
    toUnicode: new Map(),
    toCID: new Map(),
    codeSpaceRanges: [],
    name: '',
    writingMode: 0,
  };

  // Extract CMap name
  const nameMatch = text.match(/\/CMapName\s*\/(\S+)/);
  if (nameMatch) result.name = nameMatch[1];

  // Extract writing mode
  const wmMatch = text.match(/\/WMode\s+(\d+)/);
  if (wmMatch) result.writingMode = parseInt(wmMatch[1], 10);

  // Parse codespace ranges
  parseCodeSpaceRanges(text, result);

  // Parse bfchar mappings (char code → Unicode)
  parseBfChar(text, result.toUnicode);

  // Parse bfrange mappings (range → Unicode)
  parseBfRange(text, result.toUnicode);

  // Parse cidchar mappings (char code → CID)
  parseCidChar(text, result.toCID);

  // Parse cidrange mappings (range → CID)
  parseCidRange(text, result.toCID);

  return result;
}

// ─── Section parsers ────────────────────────────────────────────────────────

function parseCodeSpaceRanges(text: string, result: CMapData): void {
  const regex = /begincodespacerange\s*([\s\S]*?)endcodespacerange/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const block = match[1];
    const lineRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let lineMatch: RegExpExecArray | null;

    while ((lineMatch = lineRegex.exec(block)) !== null) {
      const low = parseInt(lineMatch[1], 16);
      const high = parseInt(lineMatch[2], 16);
      const bytes = lineMatch[1].length / 2;
      result.codeSpaceRanges.push({ low, high, bytes });
    }
  }
}

function parseBfChar(text: string, map: Map<number, string>): void {
  const regex = /beginbfchar\s*([\s\S]*?)endbfchar/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const block = match[1];
    const lineRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let lineMatch: RegExpExecArray | null;

    while ((lineMatch = lineRegex.exec(block)) !== null) {
      const charCode = parseInt(lineMatch[1], 16);
      const unicode = hexToUnicodeStr(lineMatch[2]);
      map.set(charCode, unicode);
    }
  }
}

function parseBfRange(text: string, map: Map<number, string>): void {
  const regex = /beginbfrange\s*([\s\S]*?)endbfrange/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const block = match[1];

    // Two formats:
    // <startCode> <endCode> <unicodeStart>         — sequential range
    // <startCode> <endCode> [<u1> <u2> ...]        — explicit array
    const rangeRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([\s\S]*?)\])/g;
    let rangeMatch: RegExpExecArray | null;

    while ((rangeMatch = rangeRegex.exec(block)) !== null) {
      const startCode = parseInt(rangeMatch[1], 16);
      const endCode = parseInt(rangeMatch[2], 16);

      if (rangeMatch[3]) {
        // Sequential unicode mapping
        let unicodeStart = parseInt(rangeMatch[3], 16);
        for (let code = startCode; code <= endCode; code++) {
          map.set(code, String.fromCodePoint(unicodeStart++));
        }
      } else if (rangeMatch[4]) {
        // Array of explicit unicode values
        const arrayContent = rangeMatch[4];
        const hexValues = arrayContent.match(/<([0-9a-fA-F]+)>/g) ?? [];
        for (let j = 0; j < hexValues.length && startCode + j <= endCode; j++) {
          const hex = hexValues[j].replace(/[<>]/g, '');
          map.set(startCode + j, hexToUnicodeStr(hex));
        }
      }
    }
  }
}

function parseCidChar(text: string, map: Map<number, number>): void {
  const regex = /begincidchar\s*([\s\S]*?)endcidchar/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const block = match[1];
    const lineRegex = /<([0-9a-fA-F]+)>\s+(\d+)/g;
    let lineMatch: RegExpExecArray | null;

    while ((lineMatch = lineRegex.exec(block)) !== null) {
      const charCode = parseInt(lineMatch[1], 16);
      const cid = parseInt(lineMatch[2], 10);
      map.set(charCode, cid);
    }
  }
}

function parseCidRange(text: string, map: Map<number, number>): void {
  const regex = /begincidrange\s*([\s\S]*?)endcidrange/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const block = match[1];
    const lineRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s+(\d+)/g;
    let lineMatch: RegExpExecArray | null;

    while ((lineMatch = lineRegex.exec(block)) !== null) {
      const startCode = parseInt(lineMatch[1], 16);
      const endCode = parseInt(lineMatch[2], 16);
      let cid = parseInt(lineMatch[3], 10);
      for (let code = startCode; code <= endCode; code++) {
        map.set(code, cid++);
      }
    }
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert a hex string to a Unicode string.
 * Every 4 hex digits = one Unicode code point.
 * If the hex string has 2 digits, treat as a single byte.
 */
function hexToUnicodeStr(hex: string): string {
  let result = '';
  if (hex.length <= 2) {
    // Single byte
    return String.fromCharCode(parseInt(hex, 16));
  }
  for (let i = 0; i < hex.length; i += 4) {
    if (i + 4 <= hex.length) {
      result += String.fromCodePoint(parseInt(hex.substring(i, i + 4), 16));
    } else {
      // Remaining digits
      result += String.fromCodePoint(parseInt(hex.substring(i), 16));
    }
  }
  return result;
}

function bytesToLatin1(data: Uint8Array): string {
  let str = '';
  for (let i = 0; i < data.length; i++) {
    str += String.fromCharCode(data[i]);
  }
  return str;
}

/**
 * Determine the number of bytes for a character code in this CMap.
 */
export function getCodeBytes(code: number, cmap: CMapData): number {
  for (let i = 0; i < cmap.codeSpaceRanges.length; i++) {
    const range = cmap.codeSpaceRanges[i];
    if (code >= range.low && code <= range.high) {
      return range.bytes;
    }
  }
  // Default: 1 byte for codes <= 0xFF, 2 bytes otherwise
  return code > 0xff ? 2 : 1;
}
