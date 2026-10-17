declare module 'pako' {
  interface Options { level?: number }
  const pako: {
    inflate(data: Uint8Array): Uint8Array;
    inflateRaw(data: Uint8Array): Uint8Array;
    deflate(data: Uint8Array, options?: Options): Uint8Array;
    deflateRaw(data: Uint8Array, options?: Options): Uint8Array;
    gzip(data: Uint8Array, options?: Options): Uint8Array;
    ungzip(data: Uint8Array): Uint8Array;
  };
  export default pako;
}
