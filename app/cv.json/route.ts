import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { buildCvData } from '@/lib/cv/buildCvData';
import { jsonResumeResponse } from '@/lib/cv/jsonResume';
import { getSiteUrl } from '@/lib/utils/site';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /cv.json: the signed-in user's CV as a JSON Resume document with the
// debate extension (lib/cv/jsonResume.ts), served inline so tools can read
// it from a URL. Same data and limiter as the download at
// /api/cv/export?format=json-resume. Signed-out requests get 401: a public
// per-slug variant (/u/<slug>/cv.json) would need its own privacy review.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const limited = await enforceRateLimit('cv:export', session.user.id);
  if (limited) return limited;

  const data = await buildCvData(session.user.id, { includeFieldStats: false });
  return jsonResumeResponse(data, { canonical: `${getSiteUrl()}/cv.json` });
}
