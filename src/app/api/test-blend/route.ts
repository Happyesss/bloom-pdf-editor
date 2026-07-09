import { NextResponse } from 'next/server';
import { parsePDF, Watermark, applyWatermarks, serializeDocument, getNextObjNum, PDFDict, PDFName, PDFStream } from '@/engine/index';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const minimalPdf = Buffer.from(
      "%PDF-1.7\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << >> >>\nendobj\n4 0 obj\n<< /Length 0 >>\nstream\n\nendstream\nendobj\nxref\n0 5\n0000000000 65535 f \n0000000009 00000 n \n0000000058 00000 n \n0000000115 00000 n \n0000000219 00000 n \ntrailer\n<< /Size 5 /Root 1 0 R >>\nstartxref\n268\n%%EOF\n"
    );

    const modes = ['Multiply', 'Screen', 'Overlay', 'Difference', 'Luminosity'];
    const results: Record<string, any> = {};

    for (const mode of modes) {
      const wm: Watermark = {
        id: `wm-${mode}`,
        type: 'text',
        text: `Test ${mode}`,
        fontName: 'Helvetica',
        fontSize: 48,
        color: [1, 0, 0],
        position: 'center',
        opacity: 0.8,
        blendMode: mode as any,
        rotation: 45,
        tile: false,
        layer: 'above',
      };

      const parsed = await parsePDF(new Uint8Array(minimalPdf));
      applyWatermarks(parsed, [wm], () => getNextObjNum(parsed));
      const pdfBytes = await serializeDocument(parsed);

      // Write to public directory
      const filePath = path.join(process.cwd(), 'public', `blend_test_${mode}.pdf`);
      fs.writeFileSync(filePath, pdfBytes);

      let gsDictStr = '';
      let bmEntry = '';
      let gsOp = '';

      for (const [, obj] of parsed.objects.entries()) {
        if (obj instanceof PDFDict) {
          const typeObj = obj.get('Type');
          if (typeObj instanceof PDFName && typeObj.name === 'ExtGState') {
            const bm = obj.get('BM');
            if (bm instanceof PDFName && bm.name === mode) {
              bmEntry = `/${mode}`;
              const entries: string[] = [];
              for (const [key, val] of obj.entries()) {
                let vStr = '';
                if (val instanceof PDFName) vStr = `/${val.name}`;
                else if (typeof val === 'object' && val !== null && 'value' in val) vStr = String((val as { value: number }).value);
                else vStr = JSON.stringify(val);
                entries.push(`/${key} ${vStr}`);
              }
              gsDictStr = `<< ${entries.join(' ')} >>`;
            }
          }
        } else if (obj instanceof PDFStream) {
          const str = Buffer.from(obj.getBytes()).toString('utf-8');
          if (str.includes('gs') && str.includes(`wm-${mode}`)) {
            const lines = str.split('\n');
            for (const line of lines) {
              if (line.includes('gs')) {
                gsOp = line.trim();
              }
            }
          }
        }
      }

      results[mode] = {
        filePath,
        gsDictStr,
        bmEntry,
        gsOp
      };
    }

    return NextResponse.json(results);
  } catch (error: any) {
    return NextResponse.json({ error: String(error), stack: error.stack }, { status: 500 });
  }
}
