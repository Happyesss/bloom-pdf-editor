import type { BloomJob, ConvertTarget } from '../bloom-api';

export interface ConvertMessage {
  id: number;
  bytes: ArrayBuffer;
  filename: string;
  target: ConvertTarget;
  pages?: number[] | null;
}

export type WorkerReply =
  | { id: number; type: 'progress'; job: BloomJob }
  | { id: number; type: 'done'; job: BloomJob; bytes: ArrayBuffer; filename: string; mimeType: string }
  | { id: number; type: 'error'; message: string };
