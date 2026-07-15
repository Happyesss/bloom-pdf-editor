export type JobState =
  | 'Uploaded'
  | 'Queued'
  | 'Parsing'
  | 'OCR'
  | 'LayoutAnalysis'
  | 'IDMGeneration'
  | 'Export'
  | 'Packaging'
  | 'Completed'
  | 'Failed'
  | 'Cancelled';

export type ConvertTarget =
  | 'docx'
  | 'xlsx'
  | 'pptx'
  | 'html'
  | 'markdown'
  | 'epub'
  | 'rtf'
  | 'odt'
  | 'txt'
  | 'json'
  | 'xml'
  | 'svg';

export const ALL_CONVERT_TARGETS: readonly ConvertTarget[] = [
  'docx',
  'xlsx',
  'pptx',
  'html',
  'markdown',
  'epub',
  'rtf',
  'odt',
  'txt',
  'json',
  'xml',
  'svg',
] as const;

export interface ConvertRequest {
  filename: string;
  target: ConvertTarget;
  pages?: number[];
  options?: Record<string, unknown>;
}

export interface Job {
  id: string;
  state: JobState;
  request: ConvertRequest;
  originalStorageKey: string;
  resultStorageKey?: string;
  rawDocumentKey?: string;
  idmKey?: string;
  error?: string;
  progress: number;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  pageCount?: number;
  metrics?: Record<string, number>;
  /** Request correlation / tracing id. */
  correlationId?: string;
}

export const TERMINAL_STATES: ReadonlySet<JobState> = new Set([
  'Completed',
  'Failed',
  'Cancelled',
]);
