import type { ExportResult } from '../../common/interfaces.js';
import type { UnifiedDocumentModel } from '../../udm/types.js';
import { extractContentBlocks, sanitizeFilename, tableToRows } from '../content.js';

export class TxtExporter {
  readonly name = 'TxtExporter' as const;

  async export(udm: UnifiedDocumentModel): Promise<ExportResult> {
    const blocks = extractContentBlocks(udm);
    const lines: string[] = [];
    for (const b of blocks) {
      switch (b.kind) {
        case 'heading':
        case 'paragraph':
        case 'quote':
        case 'code':
        case 'caption':
          lines.push(b.text, '');
          break;
        case 'list':
          b.items.forEach((item, i) => {
            lines.push(b.ordered ? `${i + 1}. ${item}` : `• ${item}`);
          });
          lines.push('');
          break;
        case 'table':
          for (const row of tableToRows(b.table)) lines.push(row.join('\t'));
          lines.push('');
          break;
        case 'image':
          lines.push(`[Image: ${b.alt}]`, '');
          break;
        case 'link':
          lines.push(`${b.text} (${b.uri})`, '');
          break;
      }
    }
    return {
      bytes: new TextEncoder().encode(lines.join('\n').trim() + '\n'),
      mimeType: 'text/plain; charset=utf-8',
      filename: `${sanitizeFilename(udm.metadata.title ?? 'document', 'document')}.txt`,
    };
  }
}
