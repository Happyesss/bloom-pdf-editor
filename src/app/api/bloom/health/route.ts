import { bloomErrorResponse, bloomHealthPayload } from '@/lib/bloom-server';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return Response.json(bloomHealthPayload());
  } catch (err) {
    return bloomErrorResponse(err);
  }
}
