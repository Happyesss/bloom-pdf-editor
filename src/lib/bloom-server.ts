import 'server-only';

import {
  ALL_CONVERT_TARGETS,
  createContainer,
  type BloomContainer,
  type ConvertRequest,
  type ConvertTarget,
  type Job,
} from '../../server/dist/lib-entry.js';

export type { ConvertRequest, ConvertTarget, Job };

/**
 * In-process Bloom engine for Next.js Route Handlers.
 * No separate :8787 process, URL, or API key required.
 *
 * Imports the compiled engine from `server/dist` (run `npm run server:build`).
 */
declare global {
  // Persist across HMR in `next dev`
  // eslint-disable-next-line no-var
  var __bloomContainer: BloomContainer | undefined;
}

export function getBloom(): BloomContainer {
  if (!globalThis.__bloomContainer) {
    const container = createContainer({
      memoryStorage: true,
      configOverrides: {
        'telemetry.enabled': process.env.BLOOM_TELEMETRY === 'true',
        'api.rateLimit.enabled': false,
        'api.key': '',
      },
    });
    container.startWorkers();
    globalThis.__bloomContainer = container;
  }
  return globalThis.__bloomContainer;
}

export function bloomHealthPayload() {
  const bloom = getBloom();
  const queueStats = bloom.queue.getStats();
  return {
    ok: true,
    engine: 'Bloom Document Intelligence Engine',
    phase: '1-15',
    mode: 'embedded' as const,
    targets: [...ALL_CONVERT_TARGETS],
    queue: {
      depth: queueStats.pending,
      deadLetter: queueStats.deadLetter,
      processing: queueStats.processing,
    },
  };
}

const TARGETS = new Set<string>(ALL_CONVERT_TARGETS);

export function parseConvertTarget(raw: unknown, fallback: ConvertTarget = 'docx'): ConvertTarget {
  if (typeof raw === 'string' && TARGETS.has(raw)) return raw as ConvertTarget;
  return fallback;
}

export async function enqueueConvert(
  bytes: Uint8Array,
  request: ConvertRequest,
): Promise<Job> {
  return getBloom().documentEngine.enqueueConversion(request, bytes);
}

export async function getJob(id: string): Promise<Job | null> {
  return getBloom().documentEngine.getJob(id);
}

export async function cancelJob(id: string): Promise<Job | null> {
  return getBloom().documentEngine.cancelJob(id);
}

export async function getDownload(id: string) {
  return getBloom().documentEngine.getDownload(id);
}

export function bloomErrorResponse(err: unknown, fallbackStatus = 500): Response {
  const message = err instanceof Error ? err.message : String(err);
  return Response.json({ error: message }, { status: fallbackStatus });
}
