import type {
  ExportResult,
  IDocumentEngine,
  IJobManager,
  IJobQueue,
  IStorageManager,
  ITelemetryManager,
} from './common/interfaces.js';
import type { ConvertRequest, Job } from '../jobs/types.js';
import { createId } from '../utils/id.js';

export class DocumentEngine implements IDocumentEngine {
  readonly name = 'DocumentEngine' as const;

  constructor(
    private readonly jobs: IJobManager,
    private readonly storage: IStorageManager,
    private readonly queue: IJobQueue,
    private readonly telemetry: ITelemetryManager,
  ) {}

  async enqueueConversion(request: ConvertRequest, bytes: Uint8Array): Promise<Job> {
    const key = `originals/${createId('pdf')}.pdf`;
    await this.storage.put(key, bytes, {
      filename: request.filename,
      contentType: 'application/pdf',
    });

    const job = await this.jobs.create(request, key);
    await this.jobs.updateState(job.id, 'Queued', { progress: 5 });

    const priorityRaw = request.options?.priority;
    const priority =
      priorityRaw === 'high' || priorityRaw === 'low' || priorityRaw === 'normal'
        ? priorityRaw
        : 'normal';
    await this.queue.enqueue(job.id, { priority });

    this.telemetry.info('job.enqueued', {
      jobId: job.id,
      correlationId: job.correlationId,
      target: request.target,
      bytes: bytes.byteLength,
      priority,
    });

    return (await this.jobs.get(job.id))!;
  }

  async getJob(id: string): Promise<Job | null> {
    return this.jobs.get(id);
  }

  async getDownload(id: string): Promise<ExportResult | null> {
    const job = await this.jobs.get(id);
    if (!job || job.state !== 'Completed' || !job.resultStorageKey) return null;

    const bytes = await this.storage.get(job.resultStorageKey);
    if (!bytes) return null;

    const ext = job.request.target;
    return {
      bytes,
      mimeType: mimeForTarget(job.request.target),
      filename: `${stripExt(job.request.filename)}.${ext}`,
    };
  }

  async cancelJob(id: string): Promise<Job | null> {
    const job = await this.jobs.get(id);
    if (!job) return null;
    if (job.state === 'Completed' || job.state === 'Failed') return job;
    this.queue.cancelPending?.(id);
    return this.jobs.cancel(id);
  }
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, '') || name;
}

function mimeForTarget(target: string): string {
  switch (target) {
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'xlsx':
      return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    case 'pptx':
      return 'application/vnd.openxmlformats-officedocument.presentationml.presentation';
    case 'html':
      return 'text/html';
    case 'markdown':
      return 'text/markdown';
    case 'epub':
      return 'application/epub+zip';
    case 'rtf':
      return 'application/rtf';
    case 'odt':
      return 'application/vnd.oasis.opendocument.text';
    case 'txt':
      return 'text/plain';
    case 'json':
      return 'application/json';
    case 'xml':
      return 'application/xml';
    case 'svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}
