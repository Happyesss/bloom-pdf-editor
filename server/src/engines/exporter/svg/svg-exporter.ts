import type { ExportResult } from '../../common/interfaces.js';
import type { UnifiedDocumentModel } from '../../udm/types.js';
import { escXml, sanitizeFilename } from '../content.js';

/**
 * Editable SVG from semantic text + vector graphics (no full-page raster).
 */
export class SvgExporter {
  readonly name = 'SvgExporter' as const;

  async export(udm: UnifiedDocumentModel): Promise<ExportResult> {
    const page = udm.idm.sections[0]?.pages[0];
    const width = page?.width ?? 612;
    const height = page?.height ?? 792;

    // Group by page; stack vertically for multi-page
    const pageIndices = new Set<number>();
    for (const n of Object.values(udm.semantic.nodes)) pageIndices.add(n.pageIndex);
    for (const o of udm.graphics?.objects ?? []) pageIndices.add(o.pageIndex);
    if (pageIndices.size === 0) pageIndices.add(0);
    const pages = [...pageIndices].sort((a, b) => a - b);

    const parts: string[] = [];
    pages.forEach((pi, idx) => {
      const yOff = idx * (height + 36);
      parts.push(`<g id="page-${pi}" transform="translate(0,${yOff})">`);
      parts.push(
        `<rect x="0" y="0" width="${width}" height="${height}" fill="#fff" stroke="#ddd"/>`,
      );

      for (const o of udm.graphics?.objects ?? []) {
        if (o.pageIndex !== pi || o.kind !== 'vector') continue;
        const v = o;
        if (v.shape === 'rectangle' || v.shape === 'rounded_rectangle') {
          parts.push(
            `<rect x="${v.bbox.x}" y="${flipY(v.bbox.y, v.bbox.height, height)}" width="${v.bbox.width}" height="${v.bbox.height}" fill="none" stroke="#333" stroke-width="1"/>`,
          );
        } else if (v.shape === 'line') {
          parts.push(
            `<line x1="${v.bbox.x}" y1="${flipY(v.bbox.y, 0, height)}" x2="${v.bbox.x + v.bbox.width}" y2="${flipY(v.bbox.y + v.bbox.height, 0, height)}" stroke="#333" stroke-width="1"/>`,
          );
        }
      }

      for (const n of Object.values(udm.semantic.nodes)) {
        if (n.pageIndex !== pi || !n.bbox || n.type === 'list_item') continue;
        if (!('text' in n) || !n.text) continue;
        const fs = n.type === 'heading' || n.type === 'title' ? 16 : 12;
        const y = flipY(n.bbox.y, n.bbox.height, height) + fs;
        parts.push(
          `<text x="${n.bbox.x}" y="${y}" font-size="${fs}" font-family="Helvetica,Arial,sans-serif">${escXml(String(n.text).slice(0, 200))}</text>`,
        );
      }
      parts.push('</g>');
    });

    const totalH = pages.length * (height + 36);
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${totalH}" viewBox="0 0 ${width} ${totalH}">
${parts.join('\n')}
</svg>
`;
    return {
      bytes: new TextEncoder().encode(svg),
      mimeType: 'image/svg+xml',
      filename: `${sanitizeFilename(udm.metadata.title ?? 'document', 'document')}.svg`,
    };
  }
}

/** PDF y (bottom-up) → SVG y (top-down). */
function flipY(y: number, h: number, pageHeight: number): number {
  return pageHeight - y - h;
}
