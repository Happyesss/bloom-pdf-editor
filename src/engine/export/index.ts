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
  ExportOptions,
  ExportLineInput,
  ExportPageInput,
} from './types';

export { DEFAULT_EXPORT_OPTIONS } from './types';
