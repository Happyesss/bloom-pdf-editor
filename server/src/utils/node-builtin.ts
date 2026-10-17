/**
 * Look up a Node built-in at runtime instead of importing it, so bundlers that
 * pack the engine for the browser (the editor's Web Worker) never see it.
 */
export function nodeBuiltin<T>(id: string): T {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const mod = proc?.getBuiltinModule?.(id) as T | undefined;
  if (!mod) throw new Error(`${id} is only available in Node.js (≥ 20.16)`);
  return mod;
}
