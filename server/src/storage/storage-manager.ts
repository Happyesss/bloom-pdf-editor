import { mkdir, readFile, writeFile, unlink, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import type { IStorageManager } from '../engines/common/interfaces.js';

export class StorageManager implements IStorageManager {
  readonly name = 'StorageManager' as const;

  constructor(private readonly root: string) {}

  private pathFor(key: string): string {
    // Prevent path traversal
    const safe = key.replace(/[^a-zA-Z0-9._/-]/g, '_').replace(/\.\./g, '_');
    return join(this.root, safe);
  }

  async put(key: string, data: Uint8Array, _meta?: Record<string, string>): Promise<string> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, data);
    return key;
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      const buf = await readFile(this.pathFor(key));
      return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    try {
      await unlink(this.pathFor(key));
    } catch {
      // ignore missing
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      await access(this.pathFor(key));
      return true;
    } catch {
      return false;
    }
  }
}

/** In-memory storage for tests. */
export class MemoryStorageManager implements IStorageManager {
  readonly name = 'StorageManager' as const;
  private readonly store = new Map<string, Uint8Array>();

  async put(key: string, data: Uint8Array): Promise<string> {
    this.store.set(key, data.slice());
    return key;
  }

  async get(key: string): Promise<Uint8Array | null> {
    const v = this.store.get(key);
    return v ? v.slice() : null;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }
}
