import { CacheManager } from './cache/cache-manager.js';
import { DocumentEngine } from './engines/document-engine.js';
import { ExportManager } from './engines/exporter/export-manager.js';
import { GraphicsReconstructionEngine } from './engines/graphics/engine.js';
import { IntermediateDocumentEngine } from './engines/idm/idm-engine.js';
import { LayoutEngine } from './engines/layout/layout-engine.js';
import { RecognitionFusionEngine } from './engines/ocr/engine.js';
import { ParserEngine } from './engines/parser/parser-engine.js';
import { SemanticStructureEngine } from './engines/semantic/engine.js';
import { DocumentStructureEngine } from './engines/structure/engine.js';
import { TableDetectionEngine } from './engines/table/engine.js';
import { TypographyAnalyzer } from './engines/typography/analyzer.js';
import { JobManager } from './jobs/job-manager.js';
import { InMemoryJobQueue } from './queues/job-queue.js';
import { MemoryStorageManager, StorageManager } from './storage/storage-manager.js';
import { TelemetryManager } from './telemetry/telemetry-manager.js';
import { ConfigurationManager } from './utils/config.js';
import { createConversionHandler } from './workers/conversion-worker.js';

export interface BloomContainer {
  config: ConfigurationManager;
  telemetry: TelemetryManager;
  storage: StorageManager | MemoryStorageManager;
  cache: CacheManager;
  jobs: JobManager;
  queue: InMemoryJobQueue;
  parser: ParserEngine;
  ocr: RecognitionFusionEngine;
  layout: LayoutEngine;
  idm: IntermediateDocumentEngine;
  typography: TypographyAnalyzer;
  semantic: SemanticStructureEngine;
  table: TableDetectionEngine;
  graphics: GraphicsReconstructionEngine;
  structure: DocumentStructureEngine;
  exporter: ExportManager;
  documentEngine: DocumentEngine;
  startWorkers(): void;
  stop(): Promise<void>;
}

export interface CreateContainerOptions {
  memoryStorage?: boolean;
  configOverrides?: Record<string, unknown>;
}

/** Compose the Bloom engine with constructor injection (SOLID). */
export function createContainer(options: CreateContainerOptions = {}): BloomContainer {
  const config = new ConfigurationManager(options.configOverrides);
  const telemetry = new TelemetryManager(config.getBoolean('telemetry.enabled', true));
  const storage = options.memoryStorage
    ? new MemoryStorageManager()
    : new StorageManager(config.getString('storage.root', './.bloom-storage'));
  const cache = new CacheManager();
  const jobs = new JobManager();
  const queue = new InMemoryJobQueue(
    config.getNumber('queue.pollIntervalMs', 50),
    config.getNumber('queue.maxRetries', 1),
  );

  const parser = new ParserEngine();
  const ocr = new RecognitionFusionEngine({
    concurrency: config.getNumber('ocr.concurrency', 4),
  });
  const layout = new LayoutEngine({
    concurrency: config.getNumber('layout.concurrency', 4),
  });
  const idm = new IntermediateDocumentEngine();
  const typography = new TypographyAnalyzer();
  const semantic = new SemanticStructureEngine();
  const table = new TableDetectionEngine();
  const graphics = new GraphicsReconstructionEngine();
  const structure = new DocumentStructureEngine();
  const exporter = new ExportManager(true);

  const documentEngine = new DocumentEngine(jobs, storage, queue, telemetry);

  const innerHandler = createConversionHandler({
    jobs,
    storage,
    parser,
    ocr,
    layout,
    idm,
    typography,
    semantic,
    table,
    graphics,
    structure,
    exporter,
    telemetry,
  });

  const timeoutMs = config.getNumber('job.timeoutMs', 120_000);
  const handler = async (jobId: string): Promise<void> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Job timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    try {
      await Promise.race([innerHandler(jobId), timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  return {
    config,
    telemetry,
    storage,
    cache,
    jobs,
    queue,
    parser,
    ocr,
    layout,
    idm,
    typography,
    semantic,
    table,
    graphics,
    structure,
    exporter,
    documentEngine,
    startWorkers() {
      queue.start(handler);
      telemetry.info('workers.started');
    },
    async stop() {
      await queue.stop();
      telemetry.info('workers.stopped');
    },
  };
}
