import type { ConvertTarget } from '../../jobs/types.js';
import type { ExportResult } from '../common/interfaces.js';
import type { UnifiedDocumentModel } from '../udm/types.js';

/**
 * Phase 14 — Export Plugin SDK.
 * Every exporter implements this contract; third-party formats plug in the same way.
 */
export interface IExportPlugin {
  readonly target: ConvertTarget;
  readonly name: string;
  initialize?(udm: UnifiedDocumentModel): void | Promise<void>;
  export(udm: UnifiedDocumentModel): Promise<ExportResult>;
  validate?(bytes: Uint8Array): boolean;
  package?(parts: Record<string, string | Uint8Array>): Uint8Array;
  cleanup?(): void;
}

/** Wrap a simple export(udm) class as an IExportPlugin. */
export function asPlugin(
  target: ConvertTarget,
  name: string,
  exportFn: (udm: UnifiedDocumentModel) => Promise<ExportResult>,
  validate?: (bytes: Uint8Array) => boolean,
): IExportPlugin {
  return {
    target,
    name,
    export: exportFn,
    validate,
  };
}
