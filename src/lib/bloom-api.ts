/**
 * Browser client for Bloom conversion via Next.js `/api/bloom/*` proxies.
 */

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

const TERMINAL: ReadonlySet<BloomJobState> = new Set(['Completed', 'Failed', 'Cancelled']);

export async function checkBloomHealth(): Promise<BloomHealth> {
  try {
    const res = await fetch('/api/bloom/health', { cache: 'no-store' });
    const data = (await res.json()) as BloomHealth & { error?: string };
    if (!res.ok) {
      return { ok: false, offline: Boolean(data.offline) || res.status === 503, error: data.error };
    }
    return { ok: Boolean(data.ok), phase: data.phase, targets: data.targets };
  } catch (err) {
    return {
      ok: false,
      offline: true,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function convertPdf(
  bytes: Uint8Array,
  filename: string,
  target: ConvertTarget,
  pages?: number[] | null,
): Promise<BloomJob> {
  const form = new FormData();
  const copy = bytes instanceof Uint8Array ? new Uint8Array(bytes) : new Uint8Array(bytes);
  const blob = new Blob([copy], { type: 'application/pdf' });
  form.append('file', blob, filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
  form.append('target', target);
  if (pages && pages.length > 0) {
    form.append('pages', JSON.stringify(pages));
  }

  const res = await fetch('/api/bloom/convert', { method: 'POST', body: form });
  const data = (await res.json()) as { job?: BloomJob; error?: string; offline?: boolean };
  if (!res.ok || !data.job) {
    const msg = data.error ?? `Convert failed (${res.status})`;
    throw new Error(msg);
  }
  return data.job;
}

export async function getBloomJob(id: string): Promise<BloomJob> {
  const res = await fetch(`/api/bloom/jobs/${encodeURIComponent(id)}`, { cache: 'no-store' });
  const data = (await res.json()) as { job?: BloomJob; error?: string };
  if (!res.ok || !data.job) {
    throw new Error(data.error ?? `Job not found (${res.status})`);
  }
  return data.job;
}

export async function pollJob(
  id: string,
  options: {
    onProgress?: (job: BloomJob) => void;
    intervalMs?: number;
    signal?: AbortSignal;
  } = {},
): Promise<BloomJob> {
  const intervalMs = options.intervalMs ?? 400;
  for (;;) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    const job = await getBloomJob(id);
    options.onProgress?.(job);
    if (TERMINAL.has(job.state)) {
      if (job.state === 'Failed') {
        throw new Error(job.error ?? 'Conversion failed');
      }
      if (job.state === 'Cancelled') {
        throw new Error('Conversion cancelled');
      }
      return job;
    }
    await sleep(intervalMs, options.signal);
  }
}

export async function downloadResult(
  id: string,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`/api/bloom/download/${encodeURIComponent(id)}`);
  if (!res.ok) {
    let message = `Download failed (${res.status})`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(message);
  }
  const blob = await res.blob();
  const filename = filenameFromDisposition(res.headers.get('Content-Disposition')) ?? 'export.bin';
  return { blob, filename };
}

/** Full convert → poll → download flow. */
export async function convertAndDownload(
  bytes: Uint8Array,
  filename: string,
  target: ConvertTarget,
  pages?: number[] | null,
  options: {
    onProgress?: (job: BloomJob) => void;
    signal?: AbortSignal;
  } = {},
): Promise<{ blob: Blob; filename: string; job: BloomJob }> {
  const job = await convertPdf(bytes, filename, target, pages);
  options.onProgress?.(job);
  const done = await pollJob(job.id, {
    onProgress: options.onProgress,
    signal: options.signal,
  });
  const file = await downloadResult(done.id);
  return { ...file, job: done };
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (star?.[1]) return decodeURIComponent(star[1].trim());
  const plain = /filename="?([^";]+)"?/i.exec(header);
  return plain?.[1]?.trim() ?? null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}
