import type { IJobQueue } from '../engines/common/interfaces.js';

export type QueuePriority = 'high' | 'normal' | 'low';

export interface EnqueueOptions {
  priority?: QueuePriority;
  /** Max automatic retries after handler failure. */
  maxRetries?: number;
}

export interface QueueStats {
  pending: number;
  high: number;
  normal: number;
  low: number;
  deadLetter: number;
  processing: boolean;
  completed: number;
  failed: number;
  retried: number;
}

interface QueueItem {
  jobId: string;
  priority: QueuePriority;
  attempts: number;
  maxRetries: number;
}

/**
 * In-process priority queue with retry + dead-letter.
 * Swap later for Redis/BullMQ behind the same interface.
 */
export class InMemoryJobQueue implements IJobQueue {
  private readonly high: QueueItem[] = [];
  private readonly normal: QueueItem[] = [];
  private readonly low: QueueItem[] = [];
  private readonly deadLetter: Array<{ jobId: string; error: string; at: string }> = [];
  private readonly attemptMap = new Map<string, number>();

  private handler: ((jobId: string) => Promise<void>) | null = null;
  private running = false;
  private processing = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private completed = 0;
  private failed = 0;
  private retried = 0;

  constructor(
    private readonly pollIntervalMs = 50,
    private readonly defaultMaxRetries = 1,
  ) {}

  async enqueue(jobId: string, options: EnqueueOptions = {}): Promise<void> {
    const item: QueueItem = {
      jobId,
      priority: options.priority ?? 'normal',
      attempts: this.attemptMap.get(jobId) ?? 0,
      maxRetries: options.maxRetries ?? this.defaultMaxRetries,
    };
    this.bucket(item.priority).push(item);
    void this.pump();
  }

  /** Remove a pending job (cancel). Returns true if found. */
  cancelPending(jobId: string): boolean {
    for (const bucket of [this.high, this.normal, this.low]) {
      const idx = bucket.findIndex((i) => i.jobId === jobId);
      if (idx >= 0) {
        bucket.splice(idx, 1);
        return true;
      }
    }
    return false;
  }

  deadLetterJobs(): Array<{ jobId: string; error: string; at: string }> {
    return [...this.deadLetter];
  }

  getStats(): QueueStats {
    return {
      pending: this.size(),
      high: this.high.length,
      normal: this.normal.length,
      low: this.low.length,
      deadLetter: this.deadLetter.length,
      processing: this.processing,
      completed: this.completed,
      failed: this.failed,
      retried: this.retried,
    };
  }

  start(handler: (jobId: string) => Promise<void>): void {
    this.handler = handler;
    this.running = true;
    this.timer = setInterval(() => void this.pump(), this.pollIntervalMs);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    while (this.processing) {
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  size(): number {
    return this.high.length + this.normal.length + this.low.length;
  }

  private bucket(p: QueuePriority): QueueItem[] {
    if (p === 'high') return this.high;
    if (p === 'low') return this.low;
    return this.normal;
  }

  private next(): QueueItem | undefined {
    return this.high.shift() ?? this.normal.shift() ?? this.low.shift();
  }

  private async pump(): Promise<void> {
    if (!this.running || this.processing || !this.handler) return;
    const item = this.next();
    if (!item) return;

    this.processing = true;
    try {
      await this.handler(item.jobId);
      this.completed += 1;
      this.attemptMap.delete(item.jobId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const attempts = (this.attemptMap.get(item.jobId) ?? 0) + 1;
      this.attemptMap.set(item.jobId, attempts);
      if (attempts <= item.maxRetries) {
        this.retried += 1;
        const delay = Math.min(2000, 50 * 2 ** attempts);
        await new Promise((r) => setTimeout(r, delay));
        await this.enqueue(item.jobId, {
          priority: item.priority,
          maxRetries: item.maxRetries,
        });
      } else {
        this.failed += 1;
        this.deadLetter.push({
          jobId: item.jobId,
          error: message,
          at: new Date().toISOString(),
        });
      }
    } finally {
      this.processing = false;
      if (this.size() > 0) void this.pump();
    }
  }
}
