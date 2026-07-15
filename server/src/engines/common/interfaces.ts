import type { RawDocument } from '../parser/raw-model.js';
import type { IntermediateDocument } from '../idm/types.js';
import type { LayoutDocument } from '../layout/types.js';
import type { TypographyAnalysis } from '../typography/types.js';
import type { SemanticDocument } from '../semantic/types.js';
import type { TableDetectionResult } from '../table/types.js';
import type { GraphicsReconstructionResult } from '../graphics/types.js';
import type { DocumentStructureResult } from '../structure/types.js';
import type { RecognitionFusionResult } from '../ocr/types.js';
import type { UnifiedDocumentModel } from '../udm/types.js';
import type { Job, JobState, ConvertRequest, ConvertTarget } from '../../jobs/types.js';

/** Dependency-injected services — exporters never depend on the parser. */

export interface IParserEngine {
  readonly name: 'ParserEngine';
  parse(bytes: Uint8Array, options?: ParseOptions): Promise<RawDocument>;
  parsePage(bytes: Uint8Array, pageIndex: number, options?: ParseOptions): Promise<RawDocument>;
}

export interface ParseOptions {
  /** Parse only these page indices (0-based). */
  pages?: number[];
  /** Enable lazy page content decoding. */
  lazy?: boolean;
  /** Parallel page content extraction concurrency. */
  concurrency?: number;
}

export interface ILayoutEngine {
  readonly name: 'LayoutEngine';
  analyze(raw: RawDocument): Promise<LayoutDocument>;
}

export interface IOcrManager {
  readonly name: 'RecognitionFusionEngine' | 'OCRManager';
  process(raw: RawDocument): Promise<RawDocument>;
  fuse?(raw: RawDocument): Promise<RecognitionFusionResult>;
}

export interface IIntermediateDocumentEngine {
  readonly name: 'IntermediateDocumentEngine';
  build(raw: RawDocument, layout?: LayoutDocument | null): Promise<IntermediateDocument>;
}

export interface ITypographyAnalyzer {
  readonly name: 'TypographyAnalyzer';
  analyze(idm: IntermediateDocument): Promise<TypographyAnalysis>;
}

export interface ISemanticStructureEngine {
  readonly name: 'SemanticStructureEngine';
  generate(input: {
    idm: IntermediateDocument;
    layout?: LayoutDocument | null;
    typography: TypographyAnalysis;
  }): Promise<SemanticDocument>;
}

export interface ITableDetectionEngine {
  readonly name: 'TableDetectionEngine';
  detect(input: {
    semantic: SemanticDocument;
    layout?: LayoutDocument | null;
    raw: RawDocument;
    typography: TypographyAnalysis;
  }): Promise<TableDetectionResult>;
}

export interface IGraphicsReconstructionEngine {
  readonly name: 'GraphicsReconstructionEngine';
  reconstruct(input: {
    semantic: SemanticDocument;
    layout?: LayoutDocument | null;
    raw: RawDocument;
    tables?: TableDetectionResult | null;
  }): Promise<GraphicsReconstructionResult>;
}

export interface IDocumentStructureEngine {
  readonly name: 'DocumentStructureEngine';
  build(input: {
    semantic: SemanticDocument;
    tables?: TableDetectionResult['tables'];
    graphics?: GraphicsReconstructionResult['graphics'] | null;
    layout?: LayoutDocument | null;
    raw: RawDocument;
    idm: IntermediateDocument;
  }): Promise<DocumentStructureResult>;
}

export interface IExportManager {
  readonly name: 'ExportManager';
  /** Exporters consume Unified Document Model only — never raw PDF / parser. */
  export(udm: UnifiedDocumentModel, target: ConvertTarget): Promise<ExportResult>;
  supportedTargets(): ConvertTarget[];
}

export interface ExportResult {
  bytes: Uint8Array;
  mimeType: string;
  filename: string;
}

export interface IStorageManager {
  readonly name: 'StorageManager';
  put(key: string, data: Uint8Array, meta?: Record<string, string>): Promise<string>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
}

export interface ICacheManager {
  readonly name: 'CacheManager';
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlMs?: number): Promise<void>;
  delete(key: string): Promise<void>;
  clear(): Promise<void>;
}

export interface ITelemetryManager {
  readonly name: 'TelemetryManager';
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
  metric(name: string, value: number, tags?: Record<string, string>): void;
  time<T>(name: string, fn: () => Promise<T>): Promise<T>;
}

export interface IConfigurationManager {
  readonly name: 'ConfigurationManager';
  get<T = unknown>(key: string, fallback?: T): T;
  getNumber(key: string, fallback: number): number;
  getString(key: string, fallback: string): string;
  getBoolean(key: string, fallback: boolean): boolean;
}

export interface IJobManager {
  readonly name: 'JobManager';
  create(request: ConvertRequest, originalKey: string): Promise<Job>;
  get(id: string): Promise<Job | null>;
  updateState(id: string, state: JobState, patch?: Partial<Job>): Promise<Job>;
  fail(id: string, error: string): Promise<Job>;
  cancel(id: string): Promise<Job>;
  list(limit?: number): Promise<Job[]>;
}

export interface IDocumentEngine {
  readonly name: 'DocumentEngine';
  /** Full pipeline orchestrator (phases advance as engines are implemented). */
  enqueueConversion(request: ConvertRequest, bytes: Uint8Array): Promise<Job>;
  getJob(id: string): Promise<Job | null>;
  getDownload(id: string): Promise<ExportResult | null>;
  cancelJob(id: string): Promise<Job | null>;
}

export interface IJobQueue {
  enqueue(jobId: string, options?: { priority?: 'high' | 'normal' | 'low'; maxRetries?: number }): Promise<void>;
  start(handler: (jobId: string) => Promise<void>): void;
  stop(): Promise<void>;
  size(): number;
  cancelPending?(jobId: string): boolean;
  getStats?(): {
    pending: number;
    deadLetter: number;
    processing: boolean;
    completed: number;
    failed: number;
    retried: number;
  };
}
