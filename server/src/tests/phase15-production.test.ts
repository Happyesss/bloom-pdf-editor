import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createApp } from '../api/app.js';
import { createContainer } from '../container.js';
import { InMemoryJobQueue } from '../queues/job-queue.js';
import { ALL_CONVERT_TARGETS } from '../jobs/types.js';

const MINIMAL_PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n',
  'utf8',
);

describe('Phase 15 — Production slice', () => {
  let container: ReturnType<typeof createContainer>;

  beforeEach(() => {
    container = createContainer({
      memoryStorage: true,
      configOverrides: {
        'telemetry.enabled': false,
        'api.rateLimit.enabled': false,
        'api.key': '',
      },
    });
    container.startWorkers();
  });

  afterEach(async () => {
    await container.stop();
  });

  it('health reports phase 1-15, targets, and queue depth', async () => {
    const app = createApp(container);
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      ok: boolean;
      phase: string;
      targets: string[];
      queue: { depth: number };
    };
    expect(body.ok).toBe(true);
    expect(body.phase).toBe('1-15');
    expect(body.targets).toEqual([...ALL_CONVERT_TARGETS]);
    expect(typeof body.queue.depth).toBe('number');
  });

  it('metrics endpoint returns queue + telemetry snapshot', async () => {
    const app = createApp(container);
    const res = await app.request('/metrics');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      queue: { pending: number; completed: number };
      telemetry: { counters: Record<string, number> };
    };
    expect(body.queue).toBeDefined();
    expect(body.telemetry.counters).toBeDefined();
  });

  it('batch enqueues multiple jobs', async () => {
    const app = createApp(container);
    const b64 = MINIMAL_PDF.toString('base64');
    const res = await app.request('/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-correlation-id': 'batch-1' },
      body: JSON.stringify({
        items: [
          { filename: 'a.pdf', target: 'txt', contentBase64: b64 },
          { filename: 'b.pdf', target: 'html', contentBase64: b64 },
        ],
      }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as {
      jobs: Array<{ id: string }>;
      correlationId: string;
    };
    expect(body.jobs).toHaveLength(2);
    expect(body.correlationId).toBe('batch-1');
  });

  it('rate limit returns 429 when exhausted', async () => {
    await container.stop();
    container = createContainer({
      memoryStorage: true,
      configOverrides: {
        'telemetry.enabled': false,
        'api.rateLimit.enabled': true,
        'api.rateLimit.capacity': 2,
        'api.rateLimit.refillPerSec': 0,
        'api.key': '',
      },
    });
    const app = createApp(container);
    expect((await app.request('/metrics')).status).toBe(200);
    expect((await app.request('/metrics')).status).toBe(200);
    expect((await app.request('/metrics')).status).toBe(429);
  });

  it('optional API key rejects missing key', async () => {
    await container.stop();
    container = createContainer({
      memoryStorage: true,
      configOverrides: {
        'telemetry.enabled': false,
        'api.rateLimit.enabled': false,
        'api.key': 'secret',
      },
    });
    const app = createApp(container);
    expect((await app.request('/metrics')).status).toBe(401);
    expect(
      (await app.request('/metrics', { headers: { 'x-api-key': 'secret' } })).status,
    ).toBe(200);
    expect((await app.request('/health')).status).toBe(200);
  });

  it('queue retries then dead-letters on persistent failure', async () => {
    const q = new InMemoryJobQueue(10, 2);
    let attempts = 0;
    q.start(async () => {
      attempts += 1;
      throw new Error('boom');
    });
    await q.enqueue('job-retry', { maxRetries: 2 });
    await waitUntil(() => q.getStats().deadLetter >= 1, 3000);
    expect(attempts).toBe(3); // initial + 2 retries
    expect(q.deadLetterJobs()[0]?.jobId).toBe('job-retry');
    await q.stop();
  });

  it('cancelPending removes queued work', async () => {
    const q = new InMemoryJobQueue(50, 0);
    // Do not start — keep items pending
    await q.enqueue('a', { priority: 'low' });
    await q.enqueue('b', { priority: 'high' });
    expect(q.size()).toBe(2);
    expect(q.cancelPending('a')).toBe(true);
    expect(q.size()).toBe(1);
    expect(q.cancelPending('missing')).toBe(false);
  });

  it('priority processes high before low', async () => {
    const q = new InMemoryJobQueue(5, 0);
    const order: string[] = [];
    await q.enqueue('low', { priority: 'low' });
    await q.enqueue('high', { priority: 'high' });
    q.start(async (id) => {
      order.push(id);
    });
    await waitUntil(() => order.length === 2, 2000);
    expect(order[0]).toBe('high');
    await q.stop();
  });
});

async function waitUntil(pred: () => boolean, ms: number): Promise<void> {
  const start = Date.now();
  while (!pred()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
}
