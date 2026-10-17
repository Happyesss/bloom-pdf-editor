/**
 * pako-backed zlib for the Bloom engine in the browser (see server/src/utils/zlib.ts).
 * pako already ships with pdf-lib.
 */
import pako from 'pako';
import type { ZlibLike } from '../../../../server/dist/lib-entry.js';

/** pako 1.x throws bare strings; Node throws Errors. */
function run(fn: () => Uint8Array): Uint8Array {
  try {
    return fn();
  } catch (err) {
    throw err instanceof Error ? err : new Error(String(err));
  }
}

export const browserZlib: ZlibLike = {
  inflateSync: (d) => run(() => pako.inflate(d)),
  inflateRawSync: (d) => run(() => pako.inflateRaw(d)),
  deflateRawSync: (d) => run(() => pako.deflateRaw(d, { level: 6 })),
  gzipSync: (d) => run(() => pako.gzip(d)),
  gunzipSync: (d) => run(() => pako.ungzip(d)),
};
