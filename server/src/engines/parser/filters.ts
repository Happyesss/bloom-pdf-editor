import { inflateRaw, inflate } from 'node:zlib';
import { promisify } from 'node:util';
import { PdfArray, PdfDict, PdfName, type PdfPrimitive } from './pdf-objects.js';

const inflateRawAsync = promisify(inflateRaw);
const inflateAsync = promisify(inflate);

/**
 * Decode PDF stream filters. Fresh Bloom implementation.
 */
export async function decodeStream(
  rawBytes: Uint8Array,
  dict: PdfDict,
): Promise<Uint8Array> {
  const filter = dict.get('Filter');
  const params = dict.get('DecodeParms') ?? dict.get('DP');

  if (!filter) return rawBytes;

  const filters = normalizeFilters(filter);
  const paramList = normalizeParams(params, filters.length);

  let data = rawBytes;
  for (let i = 0; i < filters.length; i++) {
    data = await applyFilter(filters[i]!, data, paramList[i] ?? null);
  }
  return data;
}

function normalizeFilters(filter: PdfPrimitive): string[] {
  if (filter instanceof PdfName) return [filter.value];
  if (filter instanceof PdfArray) {
    return filter.items
      .filter((v): v is PdfName => v instanceof PdfName)
      .map((v) => v.value);
  }
  return [];
}

function normalizeParams(params: PdfPrimitive, count: number): Array<PdfDict | null> {
  if (params instanceof PdfDict) {
    return Array.from({ length: count }, () => params);
  }
  if (params instanceof PdfArray) {
    return params.items.map((v) => (v instanceof PdfDict ? v : null));
  }
  return Array.from({ length: count }, () => null);
}

async function applyFilter(
  name: string,
  data: Uint8Array,
  params: PdfDict | null,
): Promise<Uint8Array> {
  switch (name) {
    case 'FlateDecode':
    case 'Fl':
      return decodeFlate(data, params);
    case 'ASCIIHexDecode':
    case 'AHx':
      return decodeAsciiHex(data);
    case 'ASCII85Decode':
    case 'A85':
      return decodeAscii85(data);
    case 'RunLengthDecode':
    case 'RL':
      return decodeRunLength(data);
    default:
      // Leave unknown filters as-is; content extractor may still use raw.
      return data;
  }
}

async function decodeFlate(data: Uint8Array, params: PdfDict | null): Promise<Uint8Array> {
  let inflated: Buffer;
  try {
    inflated = await inflateAsync(Buffer.from(data));
  } catch {
    inflated = await inflateRawAsync(Buffer.from(data));
  }

  const predictor = params?.getNumber('Predictor') ?? 1;
  if (predictor <= 1) {
    return new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength);
  }

  const columns = params?.getNumber('Columns') ?? 1;
  const colors = params?.getNumber('Colors') ?? 1;
  const bpc = params?.getNumber('BitsPerComponent') ?? 8;
  return undoPredictor(new Uint8Array(inflated), predictor, columns, colors, bpc);
}

function undoPredictor(
  data: Uint8Array,
  predictor: number,
  columns: number,
  colors: number,
  bpc: number,
): Uint8Array {
  if (predictor === 2) {
    // TIFF predictor — rarely used; return as-is for Phase 2
    return data;
  }

  const rowLen = Math.ceil((columns * colors * bpc) / 8);
  const rows: number[][] = [];
  let offset = 0;
  let prev = new Array(rowLen).fill(0);

  while (offset < data.length) {
    const filter = data[offset++] ?? 0;
    const row = new Array(rowLen).fill(0);
    for (let i = 0; i < rowLen && offset < data.length; i++) {
      const x = data[offset++] ?? 0;
      const left = i >= colors ? row[i - colors]! : 0;
      const up = prev[i]!;
      const upLeft = i >= colors ? prev[i - colors]! : 0;
      switch (filter) {
        case 0: row[i] = x; break;
        case 1: row[i] = (x + left) & 0xff; break;
        case 2: row[i] = (x + up) & 0xff; break;
        case 3: row[i] = (x + Math.floor((left + up) / 2)) & 0xff; break;
        case 4: row[i] = (x + paeth(left, up, upLeft)) & 0xff; break;
        default: row[i] = x; break;
      }
    }
    rows.push(row);
    prev = row;
  }

  const out = new Uint8Array(rows.length * rowLen);
  let o = 0;
  for (const row of rows) {
    for (const v of row) out[o++] = v;
  }
  return out;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function decodeAsciiHex(data: Uint8Array): Uint8Array {
  let hex = '';
  for (const b of data) {
    if (b === 62) break;
    const c = String.fromCharCode(b);
    if (/[0-9a-fA-F]/.test(c)) hex += c;
  }
  if (hex.length % 2) hex += '0';
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

function decodeAscii85(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let tuple = 0;
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    const c = data[i]!;
    if (c === 126 /* ~ */) break;
    if (c <= 32) continue;
    if (c === 122 /* z */ && count === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    tuple = tuple * 85 + (c - 33);
    count++;
    if (count === 5) {
      out.push((tuple >>> 24) & 0xff, (tuple >>> 16) & 0xff, (tuple >>> 8) & 0xff, tuple & 0xff);
      tuple = 0;
      count = 0;
    }
  }
  if (count > 1) {
    for (let i = count; i < 5; i++) tuple = tuple * 85 + 84;
    for (let i = 0; i < count - 1; i++) {
      out.push((tuple >>> (24 - i * 8)) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function decodeRunLength(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const len = data[i++]!;
    if (len === 128) break;
    if (len < 128) {
      for (let j = 0; j < len + 1 && i < data.length; j++) out.push(data[i++]!);
    } else {
      const b = data[i++] ?? 0;
      const count = 257 - len;
      for (let j = 0; j < count; j++) out.push(b);
    }
  }
  return new Uint8Array(out);
}
