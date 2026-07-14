/**
 * Document export — semantic page model and Markdown serializer.
 */

export {
  buildSemanticPage,
  exportPageToMarkdown,
  exportInputToMarkdown,
  resetExportBlockIdCounter,
} from './page-export';

export type {
  SemanticSpan,
  SemanticBlockKind,
  SemanticBlock,
  SemanticPage,
  SemanticTableCell,
  SemanticTableData,
  ExportOptions,
  ExportLineInput,
  ExportPageInput,
  ExportTableInput,
  ExportTableCellInput,
} from './types';

export { DEFAULT_EXPORT_OPTIONS } from './types';

export { structureToMarkdown } from './structure-serialize';
