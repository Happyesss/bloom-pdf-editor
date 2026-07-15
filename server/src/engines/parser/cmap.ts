/**
 * Minimal ToUnicode CMap parser (ported for Bloom server text extraction).
 */

export interface CMapData {
  toUnicode: Map<number, string>;
  toCID: Map<number, number>;
  codeSpaceRanges: Array<{ low: number; high: number; bytes: number }>;
  name: string;
  writingMode: number;
}

export function parseCMap(data: Uint8Array): CMapData {
  const text = bytesToLatin1(data);
  const result: CMapData = {
    toUnicode: new Map(),
    toCID: new Map(),
    codeSpaceRanges: [],
    name: '',
    writingMode: 0,
  };

  const nameMatch = text.match(/\/CMapName\s*\/(\S+)/);
  if (nameMatch) result.name = nameMatch[1]!;

  const wmMatch = text.match(/\/WMode\s+(\d+)/);
  if (wmMatch) result.writingMode = parseInt(wmMatch[1]!, 10);

  parseCodeSpaceRanges(text, result);
  parseBfChar(text, result.toUnicode);
  parseBfRange(text, result.toUnicode);
  parseCidChar(text, result.toCID);
  parseCidRange(text, result.toCID);

  return result;
}

export function defaultCodeBytes(cmap: CMapData | null, isComposite: boolean): number {
  if (cmap?.codeSpaceRanges.length) {
    return Math.max(...cmap.codeSpaceRanges.map((r) => r.bytes));
  }
  return isComposite ? 2 : 1;
}

function parseCodeSpaceRanges(text: string, result: CMapData): void {
  const regex = /begincodespacerange\s*([\s\S]*?)endcodespacerange/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1]!;
    const lineRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRegex.exec(block)) !== null) {
      const low = parseInt(lineMatch[1]!, 16);
      const high = parseInt(lineMatch[2]!, 16);
      const bytes = lineMatch[1]!.length / 2;
      result.codeSpaceRanges.push({ low, high, bytes });
    }
  }
}

function parseBfChar(text: string, map: Map<number, string>): void {
  const regex = /beginbfchar\s*([\s\S]*?)endbfchar/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1]!;
    const lineRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>/g;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRegex.exec(block)) !== null) {
      map.set(parseInt(lineMatch[1]!, 16), hexToUnicodeStr(lineMatch[2]!));
    }
  }
}

function parseBfRange(text: string, map: Map<number, string>): void {
  const regex = /beginbfrange\s*([\s\S]*?)endbfrange/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1]!;
    const rangeRegex =
      /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s*(?:<([0-9a-fA-F]+)>|\[([\s\S]*?)\])/g;
    let rangeMatch: RegExpExecArray | null;
    while ((rangeMatch = rangeRegex.exec(block)) !== null) {
      const startCode = parseInt(rangeMatch[1]!, 16);
      const endCode = parseInt(rangeMatch[2]!, 16);
      if (rangeMatch[3]) {
        let unicodeStart = parseInt(rangeMatch[3], 16);
        for (let code = startCode; code <= endCode; code++) {
          map.set(code, String.fromCodePoint(unicodeStart++));
        }
      } else if (rangeMatch[4]) {
        const hexValues = rangeMatch[4].match(/<([0-9a-fA-F]+)>/g) ?? [];
        for (let j = 0; j < hexValues.length && startCode + j <= endCode; j++) {
          const hex = hexValues[j]!.replace(/[<>]/g, '');
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
    const block = match[1]!;
    const lineRegex = /<([0-9a-fA-F]+)>\s+(\d+)/g;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRegex.exec(block)) !== null) {
      map.set(parseInt(lineMatch[1]!, 16), parseInt(lineMatch[2]!, 10));
    }
  }
}

function parseCidRange(text: string, map: Map<number, number>): void {
  const regex = /begincidrange\s*([\s\S]*?)endcidrange/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const block = match[1]!;
    const lineRegex = /<([0-9a-fA-F]+)>\s*<([0-9a-fA-F]+)>\s+(\d+)/g;
    let lineMatch: RegExpExecArray | null;
    while ((lineMatch = lineRegex.exec(block)) !== null) {
      const startCode = parseInt(lineMatch[1]!, 16);
      const endCode = parseInt(lineMatch[2]!, 16);
      let cid = parseInt(lineMatch[3]!, 10);
      for (let code = startCode; code <= endCode; code++) {
        map.set(code, cid++);
      }
    }
  }
}

function hexToUnicodeStr(hex: string): string {
  if (hex.length <= 2) return String.fromCharCode(parseInt(hex, 16));
  let result = '';
  for (let i = 0; i < hex.length; i += 4) {
    if (i + 4 <= hex.length) {
      result += String.fromCodePoint(parseInt(hex.substring(i, i + 4), 16));
    } else {
      result += String.fromCodePoint(parseInt(hex.substring(i), 16));
    }
  }
  return result;
}

function bytesToLatin1(data: Uint8Array): string {
  let str = '';
  for (let i = 0; i < data.length; i++) str += String.fromCharCode(data[i]!);
  return str;
}
