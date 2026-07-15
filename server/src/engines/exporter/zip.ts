import { deflateRawSync, inflateRawSync } from 'node:zlib';

interface ZipEntry {
  name: string;
  data: Uint8Array;
  compression: 0 | 8;
  crc: number;
  compressed: Uint8Array;
}

export interface CreateZipOptions {
  /** Force store (no deflate) for these entry names — required for EPUB mimetype. */
  storeOnly?: string[];
  /** Explicit entry order (others appended). */
  order?: string[];
}

/** Minimal ZIP writer for OOXML / ODT / EPUB packages (store + deflate). */
export function createZip(
  files: Record<string, string | Uint8Array>,
  options: CreateZipOptions = {},
): Uint8Array {
  const storeOnly = new Set(options.storeOnly ?? []);
  const names = options.order
    ? [
        ...options.order.filter((n) => n in files),
        ...Object.keys(files).filter((n) => !options.order!.includes(n)),
      ]
    : Object.keys(files);

  const entries: ZipEntry[] = [];
  for (const name of names) {
    const content = files[name]!;
    const data = typeof content === 'string' ? new TextEncoder().encode(content) : content;
    const forceStore = storeOnly.has(name);
    const compressed = forceStore ? data : deflateRawSync(data);
    const useDeflate = !forceStore && compressed.byteLength < data.byteLength;
    entries.push({
      name,
      data,
      compression: useDeflate ? 8 : 0,
      crc: crc32(data),
      compressed: useDeflate ? new Uint8Array(compressed) : data,
    });
  }

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name);
    const local = new Uint8Array(30 + nameBytes.length + e.compressed.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0, true);
    lv.setUint16(8, e.compression, true);
    lv.setUint16(10, 0, true);
    lv.setUint16(12, 0, true);
    lv.setUint32(14, e.crc >>> 0, true);
    lv.setUint32(18, e.compressed.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true);
    local.set(nameBytes, 30);
    local.set(e.compressed, 30 + nameBytes.length);
    localParts.push(local);

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true);
    cv.setUint16(10, e.compression, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, e.crc >>> 0, true);
    cv.setUint32(20, e.compressed.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true);
    cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true);
    cv.setUint16(36, 0, true);
    cv.setUint32(38, 0, true);
    cv.setUint32(42, offset, true);
    central.set(nameBytes, 46);
    centralParts.push(central);

    offset += local.length;
  }

  const centralSize = centralParts.reduce((s, p) => s + p.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, offset, true);
  ev.setUint16(20, 0, true);

  const total =
    localParts.reduce((s, p) => s + p.length, 0) + centralSize + end.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of localParts) {
    out.set(p, o);
    o += p.length;
  }
  for (const p of centralParts) {
    out.set(p, o);
    o += p.length;
  }
  out.set(end, o);
  return out;
}

/** Read uncompressed file contents from a ZIP (for tests). */
export function readZipEntry(zip: Uint8Array, name: string): Uint8Array | null {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  let offset = 0;
  while (offset + 30 <= zip.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;
    const compression = view.getUint16(offset + 8, true);
    const compSize = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const entryName = new TextDecoder().decode(
      zip.subarray(offset + 30, offset + 30 + nameLen),
    );
    const dataStart = offset + 30 + nameLen + extraLen;
    const data = zip.subarray(dataStart, dataStart + compSize);
    if (entryName === name) {
      if (compression === 0) return data;
      if (compression === 8) return new Uint8Array(inflateRawSync(data));
      return null;
    }
    offset = dataStart + compSize;
  }
  return null;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}
