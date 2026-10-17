/// <reference lib="webworker" />
/**
 * Runs the Bloom document engine (server/dist) inside a Web Worker so
 * PDF → DOCX / XLSX / PPTX / … conversion needs no server at all.
 */
import './shims/globals';
import { browserZlib } from './shims/zlib';
import type { BloomContainer, Job } from '../../../server/dist/lib-entry.js';
import type { BloomJob } from '../bloom-api';
import type { ConvertMessage, WorkerReply } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const TERMINAL = new Set(['Completed', 'Failed', 'Cancelled']);

let container: Promise<BloomContainer> | null = null;

function engine(): Promise<BloomContainer> {
  container ??= import('../../../server/dist/lib-entry.js').then(({ createContainer, provideZlib }) => {
    provideZlib(browserZlib);
    const c = createContainer({
      memoryStorage: true,
      configOverrides: {
        'telemetry.enabled': false,
        'api.rateLimit.enabled': false,
        'api.key': '',
      },
    });
    c.startWorkers();
    return c;
  });
  return container;
}

function toBloomJob(job: Job): BloomJob {
  return {
    id: job.id,
    state: job.state,
    progress: job.progress,
    error: job.error,
    request: { filename: job.request.filename, target: job.request.target, pages: job.request.pages },
  } as BloomJob;
}

const post = (msg: WorkerReply, transfer: Transferable[] = []) => self.postMessage(msg, transfer);

self.onmessage = async (event: MessageEvent<ConvertMessage>) => {
  const { id, bytes, filename, target, pages } = event.data;
  try {
    const bloom = await engine();
    const queued = await bloom.documentEngine.enqueueConversion(
      { filename, target, pages: pages && pages.length ? pages : undefined, options: {} },
      new Uint8Array(bytes),
    );
    let job: Job | null = queued;
    post({ id, type: 'progress', job: toBloomJob(queued) });
    let lastProgress = -1;
    for (;;) {
      job = await bloom.documentEngine.getJob(queued.id);
      if (!job) throw new Error('Conversion job disappeared');
      if (job.progress !== lastProgress) {
        lastProgress = job.progress;
        post({ id, type: 'progress', job: toBloomJob(job) });
      }
      if (TERMINAL.has(job.state)) break;
      await new Promise((r) => setTimeout(r, 40));
    }
    if (job.state !== 'Completed') throw new Error(job.error ?? `Conversion ${job.state.toLowerCase()}`);
    const result = await bloom.documentEngine.getDownload(job.id);
    if (!result) throw new Error('Converted file is missing');
    const out = result.bytes.slice().buffer as ArrayBuffer;
    post({ id, type: 'done', job: toBloomJob(job), bytes: out, filename: result.filename, mimeType: result.mimeType }, [out]);
  } catch (err) {
    post({ id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
