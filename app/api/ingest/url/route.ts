import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ingestPrivateUrl } from '@/lib/calicotab/ingest';
import { PRIVATE_URL_RE } from '@/lib/gmail/extract';
import { IngestJobStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  url: z.string().url(),
  force: z.boolean().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const parse = Body.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json({ error: 'bad_request', details: parse.error.flatten() }, { status: 400 });
  }
  PRIVATE_URL_RE.lastIndex = 0;
  if (!PRIVATE_URL_RE.test(parse.data.url)) {
    return NextResponse.json({ error: 'not_a_private_url' }, { status: 400 });
  }
  try {
    const result = await ingestPrivateUrl(parse.data.url, session.user.id, {
      force: parse.data.force,
    });
    // Reconcile any IngestJob row so the dashboard doesn't show stale pending/failed.
    await prisma.ingestJob.updateMany({
      where: { userId: session.user.id, url: parse.data.url },
      data: { status: IngestJobStatus.done, finishedAt: new Date(), lastError: null },
    });
    return NextResponse.json({
      tournamentId: result.tournamentId.toString(),
      fingerprint: result.fingerprint,
      cached: result.cached,
      claimedPersonId: result.claimedPersonId?.toString() ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'ingest_failed';
    await prisma.ingestJob.updateMany({
      where: { userId: session.user.id, url: parse.data.url },
      data: {
        status: IngestJobStatus.failed,
        finishedAt: new Date(),
        lastError: msg.slice(0, 2000),
      },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
