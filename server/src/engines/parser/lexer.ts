/**
 * Byte-level PDF tokenizer (ISO 32000).
 * Fresh Bloom implementation — no dependency on the browser engine.
 */

const WHITESPACE = new Set([0, 9, 10, 12, 13, 32]);
const DELIMITERS = new Set([
  '('.charCodeAt(0),
  ')'.charCodeAt(0),
  '<'.charCodeAt(0),
  '>'.charCodeAt(0),
  '['.charCodeAt(0),
  ']'.charCodeAt(0),
  '{'.charCodeAt(0),
  '}'.charCodeAt(0),
  '/'.charCodeAt(0),
  '%'.charCodeAt(0),
]);

export type Token =
  | { kind: 'number'; value: number; raw: string }
  | { kind: 'name'; value: string }
  | { kind: 'string'; value: string; hex: boolean }
  | { kind: 'word'; value: string }
  | { kind: 'dictStart' }
  | { kind: 'dictEnd' }
  | { kind: 'arrayStart' }
  | { kind: 'arrayEnd' }
  | { kind: 'null' }
  | { kind: 'bool'; value: boolean }
  | { kind: 'eof' };

export class PdfLexer {
  private pos = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get position(): number {
    return this.pos;
  }

  seek(pos: number): void {
    this.pos = Math.max(0, Math.min(pos, this.bytes.length));
  }

  peekByte(): number {
    return this.pos < this.bytes.length ? this.bytes[this.pos]! : -1;
  }

  nextByte(): number {
    return this.pos < this.bytes.length ? this.bytes[this.pos++]! : -1;
  }

  eof(): boolean {
    return this.pos >= this.bytes.length;
  }

  skipWhitespaceAndComments(): void {
    while (!this.eof()) {
      const b = this.peekByte();
      if (WHITESPACE.has(b)) {
        this.pos++;
        continue;
      }
      if (b === 37 /* % */) {
        this.pos++;
        while (!this.eof()) {
          const c = this.nextByte();
          if (c === 10 || c === 13) break;
        }
        continue;
      }
      break;
    }
  }

  nextToken(): Token {
    this.skipWhitespaceAndComments();
    if (this.eof()) return { kind: 'eof' };

    const b = this.peekByte();

    if (b === 60 /* < */) {
      if (this.bytes[this.pos + 1] === 60) {
        this.pos += 2;
        return { kind: 'dictStart' };
      }
      return this.readHexString();
    }

    if (b === 62 /* > */) {
      if (this.bytes[this.pos + 1] === 62) {
        this.pos += 2;
        return { kind: 'dictEnd' };
      }
      this.pos++;
      return { kind: 'word', value: '>' };
    }

    if (b === 91 /* [ */) {
      this.pos++;
      return { kind: 'arrayStart' };
    }
    if (b === 93 /* ] */) {
      this.pos++;
      return { kind: 'arrayEnd' };
    }

    if (b === 40 /* ( */) return this.readLiteralString();
    if (b === 47 /* / */) return this.readName();

    if (
      b === 43 ||
      b === 45 ||
      b === 46 ||
      (b >= 48 && b <= 57)
    ) {
      return this.readNumberOrWord();
    }

    return this.readWord();
  }

  /** Read until `endstream` marker; returns stream payload bytes. */
  readStreamBytes(length: number | null): Uint8Array {
    // Optional whitespace after `stream` keyword
    if (this.peekByte() === 13) this.pos++;
    if (this.peekByte() === 10) this.pos++;

    if (length != null && length >= 0) {
      const start = this.pos;
      const end = Math.min(start + length, this.bytes.length);
      this.pos = end;
      // Consume trailing endstream
      this.skipWhitespaceAndComments();
      const word = this.readRawWord();
      if (word !== 'endstream') {
        // Search forward for endstream if length was wrong
        const idx = indexOfAscii(this.bytes, 'endstream', start);
        if (idx >= 0) {
          this.pos = idx + 'endstream'.length;
          return this.bytes.subarray(start, idx);
        }
      }
      return this.bytes.subarray(start, end);
    }

    const start = this.pos;
    const idx = indexOfAscii(this.bytes, 'endstream', start);
    if (idx < 0) {
      this.pos = this.bytes.length;
      return this.bytes.subarray(start);
    }
    let end = idx;
    if (end > start && this.bytes[end - 1] === 10) end--;
    if (end > start && this.bytes[end - 1] === 13) end--;
    this.pos = idx + 'endstream'.length;
    return this.bytes.subarray(start, end);
  }

  private readName(): Token {
    this.pos++; // skip /
    let value = '';
    while (!this.eof()) {
      const b = this.peekByte();
      if (WHITESPACE.has(b) || DELIMITERS.has(b)) break;
      if (b === 35 /* # */ && this.pos + 2 < this.bytes.length) {
        const h1 = fromHex(this.bytes[this.pos + 1]!);
        const h2 = fromHex(this.bytes[this.pos + 2]!);
        if (h1 >= 0 && h2 >= 0) {
          value += String.fromCharCode((h1 << 4) | h2);
          this.pos += 3;
          continue;
        }
      }
      value += String.fromCharCode(b);
      this.pos++;
    }
    return { kind: 'name', value };
  }

  private readLiteralString(): Token {
    this.pos++; // (
    let depth = 1;
    let value = '';
    while (!this.eof() && depth > 0) {
      const b = this.nextByte();
      if (b === 92 /* \\ */) {
        if (this.eof()) break;
        const n = this.nextByte();
        value += unescapePdf(n, this);
        continue;
      }
      if (b === 40) {
        depth++;
        value += '(';
        continue;
      }
      if (b === 41) {
        depth--;
        if (depth === 0) break;
        value += ')';
        continue;
      }
      value += String.fromCharCode(b);
    }
    return { kind: 'string', value, hex: false };
  }

  private readHexString(): Token {
    this.pos++; // <
    let hex = '';
    while (!this.eof()) {
      const b = this.nextByte();
      if (b === 62 /* > */) break;
      if (WHITESPACE.has(b)) continue;
      hex += String.fromCharCode(b);
    }
    if (hex.length % 2 === 1) hex += '0';
    let value = '';
    for (let i = 0; i < hex.length; i += 2) {
      value += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return { kind: 'string', value, hex: true };
  }

  private readNumberOrWord(): Token {
    const start = this.pos;
    let raw = '';
    while (!this.eof()) {
      const b = this.peekByte();
      if (WHITESPACE.has(b) || DELIMITERS.has(b)) break;
      raw += String.fromCharCode(b);
      this.pos++;
    }

    if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(raw)) {
      return { kind: 'number', value: Number(raw), raw };
    }

    this.pos = start;
    return this.readWord();
  }

  private readWord(): Token {
    const value = this.readRawWord();
    if (value === 'null') return { kind: 'null' };
    if (value === 'true') return { kind: 'bool', value: true };
    if (value === 'false') return { kind: 'bool', value: false };
    return { kind: 'word', value };
  }

  private readRawWord(): string {
    this.skipWhitespaceAndComments();
    let value = '';
    while (!this.eof()) {
      const b = this.peekByte();
      if (WHITESPACE.has(b) || DELIMITERS.has(b)) break;
      value += String.fromCharCode(b);
      this.pos++;
    }
    return value;
  }
}

function fromHex(b: number): number {
  if (b >= 48 && b <= 57) return b - 48;
  if (b >= 65 && b <= 70) return b - 55;
  if (b >= 97 && b <= 102) return b - 87;
  return -1;
}

function unescapePdf(n: number, lexer: PdfLexer): string {
  switch (n) {
    case 110: return '\n';
    case 114: return '\r';
    case 116: return '\t';
    case 98: return '\b';
    case 102: return '\f';
    case 40: return '(';
    case 41: return ')';
    case 92: return '\\';
    default: {
      if (n >= 48 && n <= 55) {
        let oct = String.fromCharCode(n);
        for (let i = 0; i < 2; i++) {
          const p = lexer.peekByte();
          if (p >= 48 && p <= 55) {
            oct += String.fromCharCode(lexer.nextByte());
          } else break;
        }
        return String.fromCharCode(parseInt(oct, 8) & 0xff);
      }
      return String.fromCharCode(n);
    }
  }
}

function indexOfAscii(bytes: Uint8Array, needle: string, from: number): number {
  const n = needle.length;
  outer: for (let i = from; i <= bytes.length - n; i++) {
    for (let j = 0; j < n; j++) {
      if (bytes[i + j] !== needle.charCodeAt(j)) continue outer;
    }
    return i;
  }
  return -1;
}
