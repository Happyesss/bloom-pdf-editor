import type { IJobManager } from '../engines/common/interfaces.js';
import { createId } from '../utils/id.js';
import {
  TERMINAL_STATES,
  type ConvertRequest,
  type Job,
  type JobState,
} from './types.js';

export class JobManager implements IJobManager {
  readonly name = 'JobManager' as const;
  private readonly jobs = new Map<string, Job>();

  async create(request: ConvertRequest, originalKey: string): Promise<Job> {
    const now = new Date().toISOString();
    const correlationId =
      typeof request.options?.correlationId === 'string'
        ? request.options.correlationId
        : undefined;
    const job: Job = {
      id: createId('job'),
      state: 'Uploaded',
      request,
      originalStorageKey: originalKey,
      progress: 0,
      createdAt: now,
      updatedAt: now,
      correlationId,
    };
    this.jobs.set(job.id, job);
    return { ...job };
  }

  async get(id: string): Promise<Job | null> {
    const job = this.jobs.get(id);
    return job ? { ...job } : null;
  }

  async updateState(id: string, state: JobState, patch: Partial<Job> = {}): Promise<Job> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job not found: ${id}`);
    if (TERMINAL_STATES.has(job.state) && state !== job.state) {
      throw new Error(`Job ${id} is terminal (${job.state})`);
    }

    const updated: Job = {
      ...job,
      ...patch,
      state,
      updatedAt: new Date().toISOString(),
      completedAt:
        state === 'Completed' || state === 'Failed' || state === 'Cancelled'
          ? new Date().toISOString()
          : job.completedAt,
    };
    this.jobs.set(id, updated);
    return { ...updated };
  }

  async fail(id: string, error: string): Promise<Job> {
    return this.updateState(id, 'Failed', { error, progress: 0 });
  }

  async cancel(id: string): Promise<Job> {
    return this.updateState(id, 'Cancelled');
  }

  async list(limit = 50): Promise<Job[]> {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((j) => ({ ...j }));
  }
}
