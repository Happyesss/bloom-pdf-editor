import type { ExportResult } from '../../common/interfaces.js';
import type { UnifiedDocumentModel } from '../../udm/types.js';
import { extractContentBlocks, sanitizeFilename, tableToRows } from '../content.js';

export class RtfExporter {
  readonly name = 'RtfExporter' as const;

  async export(udm: UnifiedDocumentModel): Promise<ExportResult> {
    const blocks = extractContentBlocks(udm);
    const parts: string[] = [
      '{\\rtf1\\ansi\\deff0',
      '{\\fonttbl{\\f0\\froman Times New Roman;}{\\f1\\fswiss Arial;}{\\f2\\fmodern Courier New;}}',
      '\\f1\\fs22',
    ];

    for (const b of blocks) {
      switch (b.kind) {
        case 'heading':
          parts.push(`\\pard\\sb240\\sa120\\b\\fs${36 - b.level * 2} ${escRtf(b.text)}\\b0\\fs22\\par`);
          break;
        case 'paragraph':
          parts.push(`\\pard\\sa120 ${escRtf(b.text)}\\par`);
          break;
        case 'quote':
          parts.push(`\\pard\\li720\\i ${escRtf(b.text)}\\i0\\par`);
          break;
        case 'code':
          parts.push(`\\pard\\f2\\fs18 ${escRtf(b.text)}\\f1\\fs22\\par`);
          break;
        case 'caption':
          parts.push(`\\pard\\i\\fs18 ${escRtf(b.text)}\\i0\\fs22\\par`);
          break;
        case 'list':
          b.items.forEach((item, i) => {
            const bullet = b.ordered ? `${i + 1}.` : '\\bullet';
            parts.push(`\\pard\\li360 ${bullet} ${escRtf(item)}\\par`);
          });
          break;
        case 'table': {
          const rows = tableToRows(b.table);
          for (const row of rows) {
            parts.push('\\trowd\\trgaph108');
            row.forEach((_, ci) => {
              parts.push(`\\cellx${(ci + 1) * 2000}`);
            });
            for (const cell of row) {
              parts.push(`\\pard\\intbl ${escRtf(cell)}\\cell`);
            }
            parts.push('\\row');
          }
          parts.push('\\pard\\par');
          break;
        }
        case 'image':
          parts.push(`\\pard\\i [Image: ${escRtf(b.alt)}]\\i0\\par`);
          break;
        case 'link':
          parts.push(
            `\\pard{\\field{\\*\\fldinst HYPERLINK "${escRtf(b.uri)}"}{\\fldrslt ${escRtf(b.text)}}}\\par`,
          );
          break;
      }
    }

    parts.push('}');
    const rtf = parts.join('\n');
    return {
      bytes: new TextEncoder().encode(rtf),
      mimeType: 'application/rtf',
      filename: `${sanitizeFilename(udm.metadata.title ?? 'document', 'document')}.rtf`,
    };
  }
}

function escRtf(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/\n/g, '\\par ');
}
