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
    // Store parse warnings in lastError even on success so the dashboard can surface
    // "Done but 0 teams — vueData columns=[...]" without a separate DB field.
    await prisma.ingestJob.updateMany({
      where: { userId: session.user.id, url: parse.data.url },
      data: {
        status: IngestJobStatus.done,
        finishedAt: new Date(),
        lastError: result.warnings.length > 0
          ? result.warnings.join('\n').slice(0, 2000)
          : null,
      },
    });
    // Count distinct tournaments now visible on this user's CV — every
    // TournamentParticipant whose Person has been claimed by them. The
    // dashboard surfaces this in the post-ingest toast.
    const linkedTournaments = await prisma.tournamentParticipant.findMany({
      where: { person: { claimedByUserId: session.user.id } },
      select: { tournamentId: true },
      distinct: ['tournamentId'],
    });

    return NextResponse.json({
      tournamentId: result.tournamentId.toString(),
      fingerprint: result.fingerprint,
      cached: result.cached,
      claimedPersonId: result.claimedPersonId?.toString() ?? null,
      claimedPersonName: result.claimedPersonName ?? null,
      linkedTournamentsCount: linkedTournaments.length,
      totalTeams: result.totalTeams,
      totalParticipants: result.totalParticipants,
      warnings: result.warnings,
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
