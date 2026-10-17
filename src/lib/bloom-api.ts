/**
 * Browser client for Bloom document conversion. The engine (server/dist)
 * runs in a Web Worker in this tab — no network round-trip, no server.
 */

import type { ConvertMessage, WorkerReply } from './bloom-engine/protocol';

export type ConvertTarget =
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'html'
  | 'markdown'
  | 'epub'
  | 'rtf'
  | 'odt'
  | 'txt'
  | 'json'
  | 'xml'
  | 'svg';

export type BloomJobState =
  | 'Uploaded'
  | 'Queued'
  | 'Parsing'
  | 'OCR'
  | 'LayoutAnalysis'
  | 'IDMGeneration'
  | 'Export'
  | 'Packaging'
  | 'Completed'
  | 'Failed'
  | 'Cancelled';

export interface BloomJob {
  id: string;
  state: BloomJobState;
  progress: number;
  error?: string;
  request: {
    filename: string;
    target: ConvertTarget;
    pages?: number[];
  };
  correlationId?: string;
}

export interface BloomHealth {
  ok: boolean;
  phase?: string;
  targets?: string[];
  offline?: boolean;
  error?: string;
}

export const BLOOM_CONVERT_TARGETS: readonly ConvertTarget[] = [
  'docx',
  'xlsx',
  'pptx',
  'html',
  'markdown',
  'epub',
  'rtf',
  'odt',
  'txt',
  'json',
  'xml',
  'svg',
] as const;

export const BLOOM_JOB_STATE_LABELS: Record<BloomJobState, string> = {
  Uploaded: 'Uploaded',
  Queued: 'Queued',
  Parsing: 'Parsing PDF',
  OCR: 'OCR / fusion',
  LayoutAnalysis: 'Layout analysis',
  IDMGeneration: 'Building document model',
  Export: 'Exporting',
  Packaging: 'Packaging',
  Completed: 'Completed',
  Failed: 'Failed',
  Cancelled: 'Cancelled',
};

/** File extensions the converted download should use (target ids are not always extensions). */
const EXTENSION: Partial<Record<ConvertTarget, string>> = { markdown: 'md' };

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, {
  resolve: (r: { blob: Blob; filename: string; job: BloomJob }) => void;
  reject: (e: Error) => void;
  onProgress?: (job: BloomJob) => void;
}>();

function getWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./bloom-engine/bloom.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<WorkerReply>) => {
    const msg = event.data;
    const entry = pending.get(msg.id);
    if (!entry) return;
    if (msg.type === 'progress') {
      entry.onProgress?.(msg.job);
      return;
    }
    pending.delete(msg.id);
    if (msg.type === 'error') {
      entry.reject(new Error(msg.message));
      return;
    }
    const ext = EXTENSION[msg.job.request.target];
    const filename = ext ? msg.filename.replace(/\.[^.]+$/, `.${ext}`) : msg.filename;
    entry.resolve({ blob: new Blob([msg.bytes], { type: msg.mimeType }), filename, job: msg.job });
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || 'Conversion engine failed to load');
    for (const entry of pending.values()) entry.reject(error);
    pending.clear();
    worker?.terminate();
    worker = null;
  };
  return worker;
}

/** The engine runs in a Web Worker in this tab, so it is available whenever workers are. */
export async function checkBloomHealth(): Promise<BloomHealth> {
  if (typeof Worker === 'undefined') {
    return { ok: false, error: 'This browser does not support Web Workers' };
  }
  return { ok: true, phase: 'in-browser', targets: [...BLOOM_CONVERT_TARGETS] };
}

/** Convert a PDF in the in-browser Bloom engine and return the converted file. */
export function convertAndDownload(
  bytes: Uint8Array,
  filename: string,
  target: ConvertTarget,
  pages?: number[] | null,
  options: {
    onProgress?: (job: BloomJob) => void;
    signal?: AbortSignal;
  } = {},
): Promise<{ blob: Blob; filename: string; job: BloomJob }> {
  if (options.signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject, onProgress: options.onProgress });
    options.signal?.addEventListener(
      'abort',
      () => {
        if (pending.delete(id)) reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
    const copy = bytes.slice().buffer as ArrayBuffer;
    const message: ConvertMessage = {
      id,
      bytes: copy,
      filename: filename.toLowerCase().endsWith('.pdf') ? filename : `${filename}.pdf`,
      target,
      pages,
    };
    try {
      getWorker().postMessage(message, [copy]);
    } catch (err) {
      pending.delete(id);
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}
