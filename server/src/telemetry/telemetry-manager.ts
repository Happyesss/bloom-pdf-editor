import type { ITelemetryManager } from '../engines/common/interfaces.js';

export class TelemetryManager implements ITelemetryManager {
  readonly name = 'TelemetryManager' as const;
  private readonly counters = new Map<string, number>();
  private readonly durations = new Map<string, number[]>();

  constructor(private readonly enabled = true) {}

  info(event: string, data?: Record<string, unknown>): void {
    if (!this.enabled) return;
    console.log(JSON.stringify({ level: 'info', event, ...data, ts: Date.now() }));
  }

  warn(event: string, data?: Record<string, unknown>): void {
    if (!this.enabled) return;
    console.warn(JSON.stringify({ level: 'warn', event, ...data, ts: Date.now() }));
  }

  error(event: string, data?: Record<string, unknown>): void {
    if (!this.enabled) return;
    console.error(JSON.stringify({ level: 'error', event, ...data, ts: Date.now() }));
  }

  metric(name: string, value: number, tags?: Record<string, string>): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + 1);
    if (name.endsWith('.duration_ms')) {
      let arr = this.durations.get(name);
      if (!arr) {
        arr = [];
        this.durations.set(name, arr);
      }
      arr.push(value);
      if (arr.length > 200) arr.shift();
    }
    if (!this.enabled) return;
    console.log(JSON.stringify({ level: 'metric', name, value, tags, ts: Date.now() }));
  }

  snapshot(): {
    counters: Record<string, number>;
    averages: Record<string, number>;
  } {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) counters[k] = v;
    const averages: Record<string, number> = {};
    for (const [k, arr] of this.durations) {
      averages[k] = arr.reduce((a, b) => a + b, 0) / Math.max(arr.length, 1);
    }
    return { counters, averages };
  }

  async time<T>(name: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      return await fn();
    } finally {
      this.metric(`${name}.duration_ms`, performance.now() - start);
    }
  }
}
