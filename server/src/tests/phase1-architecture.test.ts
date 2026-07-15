import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createContainer, type BloomContainer } from '../container.js';
import { createApp } from '../api/app.js';
import { buildEmptyPagePdf } from './helpers/minimal-pdf.js';
import { createEmptyDocument } from '../engines/idm/types.js';

describe('Phase 1 — architecture', () => {
  let container: BloomContainer;

  beforeEach(() => {
    container = createContainer({
      memoryStorage: true,
      configOverrides: { 'telemetry.enabled': false },
    });
    container.startWorkers();
  });

  afterEach(async () => {
    await container.stop();
  });

  it('wires all managers via DI container', () => {
    expect(container.parser.name).toBe('ParserEngine');
    expect(container.jobs.name).toBe('JobManager');
    expect(container.layout.name).toBe('LayoutEngine');
    expect(container.ocr.name).toBe('RecognitionFusionEngine');
    expect(container.exporter.supportedTargets()).toContain('docx');
    expect(container.exporter.supportedTargets()).toContain('xlsx');
    expect(container.exporter.supportedTargets()).toContain('pptx');
    expect(container.idm.name).toBe('IntermediateDocumentEngine');
    expect(container.exporter.name).toBe('ExportManager');
    expect(container.typography.name).toBe('TypographyAnalyzer');
    expect(container.semantic.name).toBe('SemanticStructureEngine');
    expect(container.table.name).toBe('TableDetectionEngine');
    expect(container.graphics.name).toBe('GraphicsReconstructionEngine');
    expect(container.structure.name).toBe('DocumentStructureEngine');
    expect(container.documentEngine.name).toBe('DocumentEngine');
    expect(container.storage.name).toBe('StorageManager');
    expect(container.cache.name).toBe('CacheManager');
    expect(container.telemetry.name).toBe('TelemetryManager');
    expect(container.config.name).toBe('ConfigurationManager');
  });

  it('IDM skeleton has sections/pages/blocks structure', () => {
    const doc = createEmptyDocument('idm_test', 2, { title: 'Test' });
    expect(doc.metadata.pageCount).toBe(2);
    expect(doc.sections).toEqual([]);
    expect(doc.bookmarks).toEqual([]);
    expect(doc.footnotes).toEqual([]);
  });

  it('POST /convert creates a job and completes DOCX export', async () => {
    const app = createApp(container);
    const pdf = buildEmptyPagePdf();

    const res = await app.request('/convert', {
      method: 'POST',
      headers: {
        'content-type': 'application/pdf',
        'x-target': 'docx',
        'x-filename': 'empty.pdf',
      },
      body: pdf,
    });

    expect(res.status).toBe(202);
    const body = (await res.json()) as { job: { id: string; state: string } };
    expect(body.job.id).toMatch(/^job_/);
    expect(['Uploaded', 'Queued', 'Parsing', 'Failed', 'Completed']).toContain(body.job.state);

    // Wait for worker
    let final = body.job as { state: string; idmKey?: string; resultStorageKey?: string; metrics?: { pageCount: number } };
    for (let i = 0; i < 80; i++) {
      await new Promise((r) => setTimeout(r, 25));
      const status = await app.request(`/jobs/${body.job.id}`);
      const json = (await status.json()) as { job: typeof final };
      final = json.job;
      if (json.job.state === 'Failed' || json.job.state === 'Completed') {
        break;
      }
    }
    expect(final.state).toBe('Completed');
    expect(final.resultStorageKey).toBeTruthy();
    expect(final.metrics?.pageCount).toBe(1);
  });

  it('GET /jobs/:id 404 for unknown', async () => {
    const app = createApp(container);
    const res = await app.request('/jobs/missing');
    expect(res.status).toBe(404);
  });

  it('DELETE /jobs/:id cancels a queued job', async () => {
    const app = createApp(container);
    // Stop workers so job stays queued
    await container.stop();

    const job = await container.documentEngine.enqueueConversion(
      { filename: 'a.pdf', target: 'markdown' },
      buildEmptyPagePdf(),
    );

    const res = await app.request(`/jobs/${job.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { job: { state: string } };
    expect(json.job.state).toBe('Cancelled');
  });
});
