import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { enqueueUrl } from '@/lib/queue';
import { MAX_CSV_BYTES, parseCsvUrls } from '@/lib/ingest/csvUrls';

export const runtime = 'nodejs';

const Body = z.object({ csv: z.string().max(MAX_CSV_BYTES) });

/**
 * Add several tournaments at once from a CSV of private URLs (owner decision
 * on paste-a-URL: a CSV option, at most 20 URLs per upload, a daily cap).
 *
 * Nothing is scraped here. Each usable URL goes onto the user's ingest queue,
 * exactly as a deferred single paste does, and the queue drains it with a full
 * time budget. Twenty tournaments inside one 60-second request would not fit.
 * The response states what happened to each line but never echoes a URL back:
 * a private URL is a credential and has no business in a response body.
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const limited = await enforceRateLimit('ingest:csv', session.user.id);
  if (limited) return limited;

  const parse = Body.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json({ error: 'bad_request', details: parse.error.flatten() }, { status: 400 });
  }

  const parsed = parseCsvUrls(parse.data.csv);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  for (const url of parsed.urls) {
    await enqueueUrl(session.user.id, url);
  }

  return NextResponse.json({
    queued: parsed.urls.length,
    rows: parsed.rows.map(({ line, status }) => ({ line, status })),
  });
}
