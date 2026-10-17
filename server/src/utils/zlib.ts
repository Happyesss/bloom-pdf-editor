/**
 * The few zlib calls the engine makes, behind a seam so the same build runs in
 * Node and in a browser Web Worker. Node gets its built-in zlib (looked up at
 * runtime, so bundlers never pull in a zlib polyfill); browsers call
 * `provideZlib()` with their own implementation before converting.
 */
import { nodeBuiltin } from './node-builtin.js';

export interface ZlibLike {
  inflateSync(data: Uint8Array): Uint8Array;
  inflateRawSync(data: Uint8Array): Uint8Array;
  deflateRawSync(data: Uint8Array): Uint8Array;
  gzipSync(data: Uint8Array): Uint8Array;
  gunzipSync(data: Uint8Array): Uint8Array;
}

let impl: ZlibLike | undefined;

export function provideZlib(zlib: ZlibLike): void {
  impl = zlib;
}

export function zlib(): ZlibLike {
  impl ??= nodeBuiltin<ZlibLike>('node:zlib');
  return impl;
}
