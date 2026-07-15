import { gunzipSync, gzipSync } from 'node:zlib';
import type { IntermediateDocument } from './types.js';
import { IDM_VERSION } from './types.js';

const BINARY_MAGIC = new TextEncoder().encode('BLMIDM01');

/**
 * Serialize IDM to JSON bytes (Uint8Array strips binary image data).
 */
export function serializeIdmJson(doc: IntermediateDocument): Uint8Array {
  const payload = toSerializable(doc);
  return new TextEncoder().encode(JSON.stringify(payload, null, 0));
}

/**
 * Binary envelope: magic + flags + length + (optional gzip) JSON payload.
 * Format is versioned via IDM_VERSION inside the JSON body.
 */
export function serializeIdmBinary(doc: IntermediateDocument, compress = false): Uint8Array {
  const json = serializeIdmJson(doc);
  const body = compress ? gzipSync(json) : json;
  const out = new Uint8Array(BINARY_MAGIC.length + 2 + 4 + body.length);
  out.set(BINARY_MAGIC, 0);
  out[BINARY_MAGIC.length] = compress ? 1 : 0;
  out[BINARY_MAGIC.length + 1] = 0; // reserved
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  view.setUint32(BINARY_MAGIC.length + 2, body.length, true);
  out.set(body, BINARY_MAGIC.length + 6);
  return out;
}

export function deserializeIdm(
  bytes: Uint8Array,
  format: 'json' | 'binary' = 'json',
): IntermediateDocument {
  if (format === 'binary' || hasMagic(bytes)) {
    return deserializeBinary(bytes);
  }
  const text = new TextDecoder().decode(bytes);
  const parsed = JSON.parse(text) as IntermediateDocument;
  assertDoc(parsed);
  return parsed;
}

function hasMagic(bytes: Uint8Array): boolean {
  if (bytes.length < BINARY_MAGIC.length) return false;
  for (let i = 0; i < BINARY_MAGIC.length; i++) {
    if (bytes[i] !== BINARY_MAGIC[i]) return false;
  }
  return true;
}

function deserializeBinary(bytes: Uint8Array): IntermediateDocument {
  if (!hasMagic(bytes)) {
    // Fallback: treat as JSON
    const text = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(text) as IntermediateDocument;
    assertDoc(parsed);
    return parsed;
  }
  const compress = bytes[BINARY_MAGIC.length] === 1;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const len = view.getUint32(BINARY_MAGIC.length + 2, true);
  const start = BINARY_MAGIC.length + 6;
  let body = bytes.subarray(start, start + len);
  if (compress) body = gunzipSync(body);
  const text = new TextDecoder().decode(body);
  const parsed = JSON.parse(text) as IntermediateDocument;
  assertDoc(parsed);
  return parsed;
}

function assertDoc(doc: IntermediateDocument): void {
  if (!doc || typeof doc !== 'object') throw new Error('Invalid IDM');
  if (!doc.id || !doc.sections) throw new Error('Invalid IDM: missing id/sections');
  if (doc.version && doc.version !== IDM_VERSION) {
    // Allow forward-compatible read; warn via throw only on major mismatch later
  }
}

/** Strip non-JSON-safe fields (e.g. Uint8Array image data). */
function toSerializable(doc: IntermediateDocument): unknown {
  return JSON.parse(
    JSON.stringify(doc, (_key, value) => {
      if (value instanceof Uint8Array) {
        return { __bytes: Buffer.from(value).toString('base64') };
      }
      return value;
    }),
  );
}
