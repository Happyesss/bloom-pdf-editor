import type { IConfigurationManager } from '../engines/common/interfaces.js';

export class ConfigurationManager implements IConfigurationManager {
  readonly name = 'ConfigurationManager' as const;

  private readonly values: Map<string, unknown>;

  constructor(overrides: Record<string, unknown> = {}) {
    this.values = new Map([
      ['server.port', Number(process.env.BLOOM_PORT ?? 8787)],
      ['server.host', process.env.BLOOM_HOST ?? '0.0.0.0'],
      ['storage.root', process.env.BLOOM_STORAGE_ROOT ?? './.bloom-storage'],
      ['queue.pollIntervalMs', Number(process.env.BLOOM_QUEUE_POLL_MS ?? 50)],
      ['queue.maxRetries', Number(process.env.BLOOM_QUEUE_MAX_RETRIES ?? 1)],
      ['job.timeoutMs', Number(process.env.BLOOM_JOB_TIMEOUT_MS ?? 120_000)],
      ['parser.concurrency', Number(process.env.BLOOM_PARSER_CONCURRENCY ?? 4)],
      ['parser.lazy', process.env.BLOOM_PARSER_LAZY !== 'false'],
      ['layout.concurrency', Number(process.env.BLOOM_LAYOUT_CONCURRENCY ?? 4)],
      ['telemetry.enabled', process.env.BLOOM_TELEMETRY !== 'false'],
      ['api.key', process.env.BLOOM_API_KEY ?? ''],
      ['api.rateLimit.enabled', process.env.BLOOM_RATE_LIMIT !== 'false'],
      ['api.rateLimit.capacity', Number(process.env.BLOOM_RATE_LIMIT_CAPACITY ?? 60)],
      ['api.rateLimit.refillPerSec', Number(process.env.BLOOM_RATE_LIMIT_REFILL ?? 30)],
      ...Object.entries(overrides),
    ]);
  }

  get<T = unknown>(key: string, fallback?: T): T {
    if (this.values.has(key)) return this.values.get(key) as T;
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing configuration key: ${key}`);
  }

  getNumber(key: string, fallback: number): number {
    const v = this.get<unknown>(key, fallback);
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  }

  getString(key: string, fallback: string): string {
    const v = this.get<unknown>(key, fallback);
    return v == null ? fallback : String(v);
  }

  getBoolean(key: string, fallback: boolean): boolean {
    const v = this.get<unknown>(key, fallback);
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return v === 'true' || v === '1';
    return Boolean(v);
  }
}
