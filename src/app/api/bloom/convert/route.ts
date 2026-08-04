import {
  bloomErrorResponse,
  enqueueConvert,
  parseConvertTarget,
  type ConvertRequest,
} from '@/lib/bloom-server';
import { createId } from '@/lib/create-id';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get('content-type') ?? '';
    let bytes: Uint8Array;
    let filename = 'document.pdf';
    let target = parseConvertTarget(request.headers.get('x-target'));
    let pages: number[] | undefined;
    let correlationId = request.headers.get('x-correlation-id') ?? undefined;
    let priority = request.headers.get('x-priority') ?? undefined;

    if (contentType.includes('multipart/form-data')) {
      const body = await request.formData();
      const file = body.get('file');
      if (!(file instanceof File)) {
        return Response.json({ error: 'Missing file field' }, { status: 400 });
      }
      filename = file.name || filename;
      bytes = new Uint8Array(await file.arrayBuffer());
      target = parseConvertTarget(body.get('target'), target);
      const pagesRaw = body.get('pages');
      if (typeof pagesRaw === 'string') {
        try {
          pages = JSON.parse(pagesRaw) as number[];
        } catch {
          return Response.json({ error: 'Invalid pages JSON' }, { status: 400 });
        }
      }
      const corr = body.get('correlationId');
      if (typeof corr === 'string') correlationId = corr;
    } else {
      filename = request.headers.get('x-filename') ?? filename;
      bytes = new Uint8Array(await request.arrayBuffer());
    }

    if (bytes.byteLength < 5 || bytes[0] !== 0x25) {
      return Response.json({ error: 'Payload does not look like a PDF' }, { status: 400 });
    }

    correlationId ??= createId('corr');
    const convertRequest: ConvertRequest = {
      filename,
      target,
      pages,
      options: {
        correlationId,
        ...(priority ? { priority } : {}),
      },
    };

    const job = await enqueueConvert(bytes, convertRequest);
    return Response.json({ job, correlationId }, { status: 202 });
  } catch (err) {
    return bloomErrorResponse(err);
  }
}
