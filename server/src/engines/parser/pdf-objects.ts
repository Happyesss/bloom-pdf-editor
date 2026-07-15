/** Low-level PDF COS object model (fresh Bloom parser — not shared with browser engine). */

export type PdfPrimitive =
  | null
  | boolean
  | number
  | string
  | PdfName
  | PdfRef
  | PdfArray
  | PdfDict
  | PdfStream;

export class PdfName {
  constructor(public readonly value: string) {}
  toString(): string {
    return `/${this.value}`;
  }
}

export class PdfRef {
  constructor(
    public readonly objectNumber: number,
    public readonly generation: number,
  ) {}

  get key(): string {
    return `${this.objectNumber}_${this.generation}`;
  }

  toString(): string {
    return `${this.objectNumber} ${this.generation} R`;
  }
}

export class PdfArray {
  constructor(public readonly items: PdfPrimitive[] = []) {}

  get length(): number {
    return this.items.length;
  }

  get(i: number): PdfPrimitive {
    return this.items[i] ?? null;
  }

  asNumbers(): number[] {
    return this.items.map((v) => (typeof v === 'number' ? v : 0));
  }
}

export class PdfDict {
  private readonly map = new Map<string, PdfPrimitive>();

  set(key: string, value: PdfPrimitive): void {
    this.map.set(key, value);
  }

  get(key: string): PdfPrimitive {
    return this.map.get(key) ?? null;
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  getName(key: string): string | null {
    const v = this.map.get(key);
    return v instanceof PdfName ? v.value : null;
  }

  getNumber(key: string): number | null {
    const v = this.map.get(key);
    return typeof v === 'number' ? v : null;
  }

  getRef(key: string): PdfRef | null {
    const v = this.map.get(key);
    return v instanceof PdfRef ? v : null;
  }

  getArray(key: string): PdfArray | null {
    const v = this.map.get(key);
    return v instanceof PdfArray ? v : null;
  }

  getDict(key: string): PdfDict | null {
    const v = this.map.get(key);
    return v instanceof PdfDict ? v : null;
  }

  entries(): IterableIterator<[string, PdfPrimitive]> {
    return this.map.entries();
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}

export class PdfStream {
  constructor(
    public readonly dict: PdfDict,
    public readonly rawBytes: Uint8Array,
  ) {}
}

export interface XRefEntry {
  objectNumber: number;
  generation: number;
  offset: number;
  inUse: boolean;
  compressed?: boolean;
  streamObjectNumber?: number;
  indexInStream?: number;
}

export interface PdfPageInfo {
  index: number;
  ref: PdfRef;
  dict: PdfDict;
  mediaBox: [number, number, number, number];
  cropBox: [number, number, number, number];
  rotate: number;
  resources: PdfDict | null;
  contentRefs: PdfRef[];
}

export interface ParsedPdf {
  version: string;
  objects: Map<string, PdfPrimitive>;
  catalog: PdfDict;
  pages: PdfPageInfo[];
  info: PdfDict | null;
  trailer: PdfDict;
  rawBytes: Uint8Array;
}
