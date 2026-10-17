/**
 * Node globals the Bloom engine touches (`process.env`, `Buffer.from(...)`),
 * installed in the conversion worker before the engine module loads.
 */
const g = globalThis as unknown as {
  process?: { env: Record<string, string | undefined>; nextTick?: (fn: (...a: unknown[]) => void, ...args: unknown[]) => void };
  Buffer?: unknown;
};

// Next's `process` polyfill hands back this global when it exists, so keep it
// complete enough for stream-style code (nextTick) as well as `env`.
g.process ??= { env: {} };
g.process.env ??= {};
g.process.nextTick ??= (fn, ...args) => queueMicrotask(() => fn(...args));

if (typeof g.Buffer === 'undefined') {
  const toBytes = (value: unknown, encoding?: string): Uint8Array => {
    if (typeof value === 'string') {
      if (encoding === 'base64') return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
      if (encoding === 'latin1' || encoding === 'binary') return Uint8Array.from(value, (c) => c.charCodeAt(0) & 0xff);
      return new TextEncoder().encode(value);
    }
    if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
    if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength));
    return Uint8Array.from(value as ArrayLike<number>);
  };

  const toString = function (this: Uint8Array, encoding = 'utf8'): string {
    if (encoding === 'base64') {
      let s = '';
      for (let i = 0; i < this.length; i += 0x8000) s += String.fromCharCode(...this.subarray(i, i + 0x8000));
      return btoa(s);
    }
    if (encoding === 'hex') return Array.from(this, (b) => b.toString(16).padStart(2, '0')).join('');
    if (encoding === 'latin1' || encoding === 'binary') {
      let s = '';
      for (let i = 0; i < this.length; i += 0x8000) s += String.fromCharCode(...this.subarray(i, i + 0x8000));
      return s;
    }
    return new TextDecoder().decode(this);
  };

  g.Buffer = {
    from(value: unknown, encoding?: string) {
      const b = toBytes(value, encoding);
      Object.defineProperty(b, 'toString', { value: toString });
      return b;
    },
    isBuffer: (v: unknown) => v instanceof Uint8Array,
  };
}

export {};
