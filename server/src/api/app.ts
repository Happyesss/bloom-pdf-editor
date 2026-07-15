import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { BloomContainer } from '../container.js';
import { ALL_CONVERT_TARGETS, type ConvertRequest, type ConvertTarget } from '../jobs/types.js';
import { createId } from '../utils/id.js';

const TARGETS = new Set<ConvertTarget>(ALL_CONVERT_TARGETS);

/** Simple in-memory token bucket rate limiter. */
function createRateLimiter(capacity: number, refillPerSec: number) {
  let tokens = capacity;
  let last = Date.now();
  return (): boolean => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * refillPerSec);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

export function createApp(container: BloomContainer): Hono {
  const app = new Hono();
  app.use('*', cors());

  const apiKey = container.config.getString('api.key', process.env.BLOOM_API_KEY ?? '');
  const rateLimitEnabled = container.config.getBoolean('api.rateLimit.enabled', true);
  const takeToken = createRateLimiter(
    container.config.getNumber('api.rateLimit.capacity', 60),
    container.config.getNumber('api.rateLimit.refillPerSec', 30),
  );

  app.use('*', async (c, next) => {
    if (c.req.path === '/health') return next();
    if (apiKey) {
      const provided = c.req.header('x-api-key') ?? '';
      if (provided !== apiKey) {
        return c.json({ error: 'Unauthorized' }, 401);
      }
    }
    if (rateLimitEnabled && !takeToken()) {
      return c.json({ error: 'Rate limit exceeded' }, 429);
    }
    await next();
  });

  app.get('/health', (c) => {
    const queueStats = container.queue.getStats();
    return c.json({
      ok: true,
      engine: 'Bloom Document Intelligence Engine',
      phase: '1-15',
      targets: [...ALL_CONVERT_TARGETS],
      queue: {
        depth: queueStats.pending,
        deadLetter: queueStats.deadLetter,
        processing: queueStats.processing,
      },
    });
  });

  app.get('/metrics', (c) => {
    const snap = container.telemetry.snapshot();
    const queueStats = container.queue.getStats();
    return c.json({
      queue: queueStats,
      telemetry: snap,
      avgConversionMs: snap.averages['convert.pipeline.duration_ms'] ?? null,
    });
  });

  /**
   * POST /convert
   * multipart: file + target (+ optional pages JSON)
   */
  app.post('/convert', async (c) => {
    const parsed = await parseConvertBody(c);
    if ('error' in parsed) return c.json({ error: parsed.error }, parsed.status);

    const correlationId =
      c.req.header('x-correlation-id') ?? createId('corr');
    const request: ConvertRequest = {
      ...parsed.request,
      options: {
        ...parsed.request.options,
        correlationId,
        priority: c.req.header('x-priority') ?? parsed.request.options?.priority,
      },
    };
    const job = await container.documentEngine.enqueueConversion(request, parsed.bytes);
    return c.json({ job, correlationId }, 202);
  });

  /**
   * POST /batch — JSON: { items: [{ filename, target, contentBase64, pages? }] }
   */
  app.post('/batch', async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'Invalid JSON body' }, 400);
    }
    const items = (body as { items?: unknown }).items;
    if (!Array.isArray(items) || items.length === 0) {
      return c.json({ error: 'Expected non-empty items array' }, 400);
    }
    if (items.length > 20) {
      return c.json({ error: 'Batch limited to 20 items' }, 400);
    }

    const correlationId = c.req.header('x-correlation-id') ?? createId('corr');
    const jobs = [];
    for (const raw of items) {
      const item = raw as {
        filename?: string;
        target?: string;
        contentBase64?: string;
        pages?: number[];
      };
      if (!item.contentBase64 || typeof item.contentBase64 !== 'string') {
        return c.json({ error: 'Each item needs contentBase64' }, 400);
      }
      const target = (item.target ?? 'docx') as ConvertTarget;
      if (!TARGETS.has(target)) {
        return c.json({ error: `Unsupported target: ${item.target}` }, 400);
      }
      const bytes = Uint8Array.from(Buffer.from(item.contentBase64, 'base64'));
      if (bytes.byteLength < 5 || bytes[0] !== 0x25) {
        return c.json({ error: 'Item payload does not look like a PDF' }, 400);
      }
      const request: ConvertRequest = {
        filename: item.filename ?? 'document.pdf',
        target,
        pages: item.pages,
        options: { correlationId },
      };
      jobs.push(await container.documentEngine.enqueueConversion(request, bytes));
    }
    return c.json({ jobs: jobs.map((j) => ({ id: j.id, state: j.state })), correlationId }, 202);
  });

  app.get('/jobs/:id', async (c) => {
    const job = await container.documentEngine.getJob(c.req.param('id'));
    if (!job) return c.json({ error: 'Job not found' }, 404);
    return c.json({ job });
  });

  app.get('/download/:id', async (c) => {
    const result = await container.documentEngine.getDownload(c.req.param('id'));
    if (!result) {
      return c.json({ error: 'Result not ready or job not found' }, 404);
    }
    return new Response(Buffer.from(result.bytes), {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      },
    });
  });

  app.delete('/jobs/:id', async (c) => {
    const job = await container.documentEngine.cancelJob(c.req.param('id'));
    if (!job) return c.json({ error: 'Job not found' }, 404);
    return c.json({ job });
  });

  return app;
}

async function parseConvertBody(c: {
  req: {
    header: (name: string) => string | undefined;
    parseBody: () => Promise<Record<string, unknown>>;
    arrayBuffer: () => Promise<ArrayBuffer>;
  };
}): Promise<
  | { request: ConvertRequest; bytes: Uint8Array }
  | { error: string; status: 400 }
> {
  const contentType = c.req.header('content-type') ?? '';

  let bytes: Uint8Array;
  let filename = 'document.pdf';
  let target: ConvertTarget = 'docx';
  let pages: number[] | undefined;

  if (contentType.includes('multipart/form-data')) {
    const body = await c.req.parseBody();
    const file = body['file'];
    if (!(file instanceof File)) {
      return { error: 'Missing file field', status: 400 };
    }
    filename = file.name || filename;
    bytes = new Uint8Array(await file.arrayBuffer());
    if (typeof body['target'] === 'string' && TARGETS.has(body['target'] as ConvertTarget)) {
      target = body['target'] as ConvertTarget;
    }
    if (typeof body['pages'] === 'string') {
      try {
        pages = JSON.parse(body['pages']) as number[];
      } catch {
        return { error: 'Invalid pages JSON', status: 400 };
      }
    }
  } else {
    const targetHeader = c.req.header('x-target');
    if (targetHeader && TARGETS.has(targetHeader as ConvertTarget)) {
      target = targetHeader as ConvertTarget;
    }
    filename = c.req.header('x-filename') ?? filename;
    bytes = new Uint8Array(await c.req.arrayBuffer());
  }

  if (bytes.byteLength < 5 || bytes[0] !== 0x25 /* % */) {
    return { error: 'Payload does not look like a PDF', status: 400 };
  }

  return { request: { filename, target, pages }, bytes };
}
