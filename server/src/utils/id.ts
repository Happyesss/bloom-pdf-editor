/**
 * Random ids via Web Crypto's `randomUUID`, a global in Node ≥ 19 and every
 * modern browser — so the engine also runs in the editor's Web Worker.
 */
export function createId(prefix?: string): string {
  const id = globalThis.crypto.randomUUID();
  return prefix ? `${prefix}_${id}` : id;
}
