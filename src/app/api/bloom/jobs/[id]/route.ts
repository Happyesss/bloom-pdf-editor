import { bloomErrorResponse, cancelJob, getJob } from '@/lib/bloom-server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const job = await getJob(id);
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });
    return Response.json({ job });
  } catch (err) {
    return bloomErrorResponse(err);
  }
}

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const job = await cancelJob(id);
    if (!job) return Response.json({ error: 'Job not found' }, { status: 404 });
    return Response.json({ job });
  } catch (err) {
    return bloomErrorResponse(err);
  }
}
