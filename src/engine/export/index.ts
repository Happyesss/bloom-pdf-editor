/**
 * Document export — semantic page model, HTML and Markdown serializers.
 */

export {
  buildSemanticPage,
  exportPageToHTML,
  exportPageToMarkdown,
  exportInputToHTML,
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
