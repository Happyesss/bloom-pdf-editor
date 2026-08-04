import { bloomErrorResponse, getDownload } from '@/lib/bloom-server';

export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const result = await getDownload(id);
    if (!result) {
      return Response.json({ error: 'Result not ready or job not found' }, { status: 404 });
    }
    return new Response(new Uint8Array(result.bytes), {
      status: 200,
      headers: {
        'Content-Type': result.mimeType,
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      },
    });
  } catch (err) {
    return bloomErrorResponse(err);
  }
}
