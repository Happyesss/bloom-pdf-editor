import { inflateSync, inflateRawSync } from 'node:zlib';
import { PdfLexer, type Token } from './lexer.js';
import { decodeStream } from './filters.js';
import {
  PdfArray,
  PdfDict,
  PdfName,
  PdfRef,
  PdfStream,
  type ParsedPdf,
  type PdfPageInfo,
  type PdfPrimitive,
  type XRefEntry,
} from './pdf-objects.js';

/**
 * Parse a PDF byte stream into a COS object graph + page tree.
 * Fresh Bloom parser — Phase 2 foundation.
 */
export async function parsePdfDocument(bytes: Uint8Array): Promise<ParsedPdf> {
  const version = readVersion(bytes);
  const startxref = findStartXref(bytes);
  if (startxref < 0) throw new Error('Invalid PDF: missing startxref');

  const lexer = new PdfLexer(bytes);
  const { entries, trailer } = parseXRefTable(lexer, startxref, bytes);

  // Follow /Prev chains
  let prev = trailer.getNumber('Prev');
  const allEntries = new Map<number, XRefEntry>();
  for (const e of entries) allEntries.set(e.objectNumber, e);

  while (prev != null && prev > 0) {
    const prevTable = parseXRefTable(lexer, prev, bytes);
    for (const e of prevTable.entries) {
      if (!allEntries.has(e.objectNumber)) allEntries.set(e.objectNumber, e);
    }
    prev = prevTable.trailer.getNumber('Prev');
  }

  const objects = new Map<string, PdfPrimitive>();

  // Load in-use objects (non-compressed first)
  for (const entry of allEntries.values()) {
    if (!entry.inUse || entry.compressed) continue;
    try {
      const obj = readIndirectObject(lexer, entry.offset);
      objects.set(new PdfRef(entry.objectNumber, entry.generation).key, obj);
    } catch {
      // Skip corrupt objects
    }
  }

  // Object streams
  for (const entry of allEntries.values()) {
    if (!entry.inUse || !entry.compressed || entry.streamObjectNumber == null) continue;
    const streamRef = new PdfRef(entry.streamObjectNumber, 0);
    const streamObj = objects.get(streamRef.key);
    if (!(streamObj instanceof PdfStream)) continue;
    const decoded = await decodeStream(streamObj.rawBytes, streamObj.dict);
    const n = streamObj.dict.getNumber('N') ?? 0;
    const first = streamObj.dict.getNumber('First') ?? 0;
    const pairs = parseObjectStreamIndex(decoded, n, first);
    const idx = entry.indexInStream ?? 0;
    if (idx < pairs.length) {
      const { objectNumber, offset } = pairs[idx]!;
      const objLexer = new PdfLexer(decoded.subarray(first + offset));
      const value = readObject(objLexer);
      objects.set(new PdfRef(objectNumber, 0).key, value);
    }
  }

  const rootRef = trailer.getRef('Root');
  if (!rootRef) throw new Error('Invalid PDF: missing /Root');
  const catalog = resolve(objects, rootRef);
  if (!(catalog instanceof PdfDict)) throw new Error('Invalid PDF: catalog is not a dict');

  const pages = collectPages(objects, catalog);
  const infoRef = trailer.getRef('Info');
  const info = infoRef ? (resolve(objects, infoRef) as PdfDict | null) : null;

  return {
    version,
    objects,
    catalog,
    pages,
    info: info instanceof PdfDict ? info : null,
    trailer,
    rawBytes: bytes,
  };
}

export function resolve(
  objects: Map<string, PdfPrimitive>,
  value: PdfPrimitive,
  depth = 0,
): PdfPrimitive {
  if (depth > 64) return value;
  if (value instanceof PdfRef) {
    return resolve(objects, objects.get(value.key) ?? null, depth + 1);
  }
  return value;
}

export async function getPageContentBytes(
  page: PdfPageInfo,
  objects: Map<string, PdfPrimitive>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  for (const ref of page.contentRefs) {
    const obj = resolve(objects, ref);
    if (obj instanceof PdfStream) {
      chunks.push(await decodeStream(obj.rawBytes, obj.dict));
    } else if (obj instanceof PdfArray) {
      for (const item of obj.items) {
        if (item instanceof PdfRef) {
          const s = resolve(objects, item);
          if (s instanceof PdfStream) {
            chunks.push(await decodeStream(s.rawBytes, s.dict));
          }
        }
      }
    }
  }
  return concat(chunks);
}

function readVersion(bytes: Uint8Array): string {
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 32));
  const m = head.match(/%PDF-(\d+\.\d+)/);
  return m?.[1] ?? '1.4';
}

function findStartXref(bytes: Uint8Array): number {
  const tail = new TextDecoder('latin1').decode(bytes.subarray(Math.max(0, bytes.length - 2048)));
  const m = tail.match(/startxref\s+(\d+)\s*%%EOF/);
  return m ? Number(m[1]) : -1;
}

function parseXRefTable(
  lexer: PdfLexer,
  offset: number,
  bytes: Uint8Array,
): { entries: XRefEntry[]; trailer: PdfDict } {
  lexer.seek(offset);
  lexer.skipWhitespaceAndComments();
  const first = lexer.nextToken();

  // xref stream
  if (first.kind === 'number') {
    const genTok = lexer.nextToken();
    const objTok = lexer.nextToken();
    if (genTok.kind === 'number' && objTok.kind === 'word' && objTok.value === 'obj') {
      const streamObj = readObject(lexer);
      if (streamObj instanceof PdfStream) {
        return parseXRefStreamSync(streamObj);
      }
    }
  }

  if (first.kind !== 'word' || first.value !== 'xref') {
    // Try scanning nearby for "xref"
    const slice = new TextDecoder('latin1').decode(bytes.subarray(offset, Math.min(bytes.length, offset + 64)));
    if (!slice.includes('xref')) {
      throw new Error(`Expected xref at ${offset}`);
    }
    lexer.seek(offset);
    // consume until xref
    while (!lexer.eof()) {
      const t = lexer.nextToken();
      if (t.kind === 'word' && t.value === 'xref') break;
    }
  }

  const entries: XRefEntry[] = [];
  while (true) {
    lexer.skipWhitespaceAndComments();
    const t = lexer.nextToken();
    if (t.kind === 'word' && t.value === 'trailer') break;
    if (t.kind !== 'number') break;
    const start = t.value;
    const countTok = lexer.nextToken();
    if (countTok.kind !== 'number') break;
    const count = countTok.value;

    for (let i = 0; i < count; i++) {
      const offTok = lexer.nextToken();
      const genTok = lexer.nextToken();
      const flagTok = lexer.nextToken();
      if (offTok.kind !== 'number' || genTok.kind !== 'number' || flagTok.kind !== 'word') {
        break;
      }
      entries.push({
        objectNumber: start + i,
        offset: offTok.value,
        generation: genTok.value,
        inUse: flagTok.value === 'n',
      });
    }
  }

  const trailerObj = readObject(lexer);
  if (!(trailerObj instanceof PdfDict)) throw new Error('Invalid trailer dict');
  return { entries, trailer: trailerObj };
}

function parseXRefStreamSync(stream: PdfStream): { entries: XRefEntry[]; trailer: PdfDict } {
  let data: Buffer;
  try {
    data = inflateSync(Buffer.from(stream.rawBytes));
  } catch {
    try {
      data = inflateRawSync(Buffer.from(stream.rawBytes));
    } catch {
      data = Buffer.from(stream.rawBytes);
    }
  }

  const size = stream.dict.getNumber('Size') ?? 0;
  const wArr = stream.dict.getArray('W');
  const w = wArr ? wArr.asNumbers() : [1, 2, 1];
  const indexArr = stream.dict.getArray('Index');
  const index = indexArr ? indexArr.asNumbers() : [0, size];

  const entries: XRefEntry[] = [];
  let offset = 0;
  const rowSize = (w[0] ?? 1) + (w[1] ?? 0) + (w[2] ?? 0);

  for (let i = 0; i < index.length; i += 2) {
    const start = index[i] ?? 0;
    const count = index[i + 1] ?? 0;
    for (let n = 0; n < count; n++) {
      const row = data.subarray(offset, offset + rowSize);
      offset += rowSize;
      let p = 0;
      const type = readUint(row, p, w[0] ?? 1);
      p += w[0] ?? 1;
      const f2 = readUint(row, p, w[1] ?? 0);
      p += w[1] ?? 0;
      const f3 = readUint(row, p, w[2] ?? 0);

      const objectNumber = start + n;
      if (type === 0) {
        entries.push({ objectNumber, offset: 0, generation: f3, inUse: false });
      } else if (type === 1) {
        entries.push({ objectNumber, offset: f2, generation: f3, inUse: true });
      } else if (type === 2) {
        entries.push({
          objectNumber,
          offset: 0,
          generation: 0,
          inUse: true,
          compressed: true,
          streamObjectNumber: f2,
          indexInStream: f3,
        });
      }
    }
  }

  return { entries, trailer: stream.dict };
}

function readUint(buf: Uint8Array | Buffer, offset: number, len: number): number {
  let v = 0;
  for (let i = 0; i < len; i++) {
    v = (v << 8) | (buf[offset + i] ?? 0);
  }
  return v;
}

function readIndirectObject(lexer: PdfLexer, offset: number): PdfPrimitive {
  lexer.seek(offset);
  const num = lexer.nextToken();
  const gen = lexer.nextToken();
  const obj = lexer.nextToken();
  if (num.kind !== 'number' || gen.kind !== 'number' || obj.kind !== 'word' || obj.value !== 'obj') {
    throw new Error(`Invalid indirect object at ${offset}`);
  }
  const value = readObject(lexer);
  return value;
}

function readObject(lexer: PdfLexer): PdfPrimitive {
  const token = lexer.nextToken();
  return tokenToObject(lexer, token);
}

function tokenToObject(lexer: PdfLexer, token: Token): PdfPrimitive {
  switch (token.kind) {
    case 'null':
      return null;
    case 'bool':
      return token.value;
    case 'number': {
      // Could be start of "n g R"
      const save = lexer.position;
      const t2 = lexer.nextToken();
      const t3 = lexer.nextToken();
      if (t2.kind === 'number' && t3.kind === 'word' && t3.value === 'R') {
        return new PdfRef(token.value, t2.value);
      }
      lexer.seek(save);
      return token.value;
    }
    case 'name':
      return new PdfName(token.value);
    case 'string':
      return token.value;
    case 'arrayStart': {
      const items: PdfPrimitive[] = [];
      while (true) {
        const t = lexer.nextToken();
        if (t.kind === 'arrayEnd' || t.kind === 'eof') break;
        items.push(tokenToObject(lexer, t));
      }
      return new PdfArray(items);
    }
    case 'dictStart': {
      const dict = new PdfDict();
      while (true) {
        const keyTok = lexer.nextToken();
        if (keyTok.kind === 'dictEnd' || keyTok.kind === 'eof') break;
        if (keyTok.kind !== 'name') {
          // recover
          continue;
        }
        const value = readObject(lexer);
        dict.set(keyTok.value, value);
      }

      // stream?
      const save = lexer.position;
      const next = lexer.nextToken();
      if (next.kind === 'word' && next.value === 'stream') {
        const length = dict.getNumber('Length');
        const raw = lexer.readStreamBytes(length);
        return new PdfStream(dict, raw);
      }
      lexer.seek(save);
      return dict;
    }
    case 'word':
      if (token.value === 'stream') {
        throw new Error('Unexpected stream keyword');
      }
      return token.value;
    default:
      return null;
  }
}

function parseObjectStreamIndex(
  data: Uint8Array,
  n: number,
  first: number,
): Array<{ objectNumber: number; offset: number }> {
  const lexer = new PdfLexer(data.subarray(0, first));
  const pairs: Array<{ objectNumber: number; offset: number }> = [];
  for (let i = 0; i < n; i++) {
    const a = lexer.nextToken();
    const b = lexer.nextToken();
    if (a.kind !== 'number' || b.kind !== 'number') break;
    pairs.push({ objectNumber: a.value, offset: b.value });
  }
  return pairs;
}

function collectPages(objects: Map<string, PdfPrimitive>, catalog: PdfDict): PdfPageInfo[] {
  const pagesRef = catalog.getRef('Pages');
  if (!pagesRef) return [];
  const pagesRoot = resolve(objects, pagesRef);
  if (!(pagesRoot instanceof PdfDict)) return [];

  const out: PdfPageInfo[] = [];
  walkPages(objects, pagesRoot, null, out);
  out.forEach((p, i) => {
    p.index = i;
  });
  return out;
}

function walkPages(
  objects: Map<string, PdfPrimitive>,
  node: PdfDict,
  inheritedResources: PdfDict | null,
  out: PdfPageInfo[],
  parentRef?: PdfRef,
): void {
  const type = node.getName('Type');
  const resources =
    (node.getDict('Resources') as PdfDict | null) ??
    (node.getRef('Resources')
      ? (resolve(objects, node.getRef('Resources')!) as PdfDict)
      : inheritedResources);

  if (type === 'Pages' || node.has('Kids')) {
    const kids = node.getArray('Kids');
    if (!kids) return;
    for (const kid of kids.items) {
      if (!(kid instanceof PdfRef)) continue;
      const child = resolve(objects, kid);
      if (child instanceof PdfDict) {
        walkPages(objects, child, resources instanceof PdfDict ? resources : inheritedResources, out, kid);
      }
    }
    return;
  }

  // Page node
  const media = rectFrom(node, objects, 'MediaBox') ?? [0, 0, 612, 792];
  const crop = rectFrom(node, objects, 'CropBox') ?? media;
  const rotate = node.getNumber('Rotate') ?? 0;

  const contentRefs: PdfRef[] = [];
  const contents = node.get('Contents');
  if (contents instanceof PdfRef) {
    contentRefs.push(contents);
  } else if (contents instanceof PdfArray) {
    for (const c of contents.items) {
      if (c instanceof PdfRef) contentRefs.push(c);
    }
  }

  const ref = parentRef ?? new PdfRef(out.length + 1, 0);
  out.push({
    index: out.length,
    ref,
    dict: node,
    mediaBox: media,
    cropBox: crop,
    rotate,
    resources: resources instanceof PdfDict ? resources : null,
    contentRefs,
  });
}

function rectFrom(
  dict: PdfDict,
  objects: Map<string, PdfPrimitive>,
  key: string,
): [number, number, number, number] | null {
  let v: PdfPrimitive = dict.get(key);
  if (v instanceof PdfRef) v = resolve(objects, v);
  if (!(v instanceof PdfArray) || v.length < 4) return null;
  const n = v.asNumbers();
  return [n[0] ?? 0, n[1] ?? 0, n[2] ?? 0, n[3] ?? 0];
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const len = chunks.reduce((a, c) => a + c.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
