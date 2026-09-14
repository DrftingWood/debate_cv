import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { prisma } from '@/lib/db';
import { ingestPrivateUrl, isDeadlockError } from '@/lib/calicotab/ingest';
import { isPrivateUrl, privateUrlVariants } from '@/lib/gmail/extract';
import { IngestJobStatus } from '@prisma/client';

export const runtime = 'nodejs';
// 60s is the Vercel Hobby cap. WUDC-scale tournaments now fit because the
// hot per-row speakerRoundScore loop was replaced with a post-tx bulk
// createMany — see lib/calicotab/ingest.ts.
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
  const limited = await enforceRateLimit('ingest:url', session.user.id);
  if (limited) return limited;
  const parse = Body.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json({ error: 'bad_request', details: parse.error.flatten() }, { status: 400 });
  }
  // isPrivateUrl, NOT PRIVATE_URL_RE.test — the regex is an unanchored
  // scanner for finding URLs inside email prose, so testing a whole string
  // against it passes anything that merely contains a match. That was an
  // SSRF: `http://169.254.169.254/?x=https://a.calicotab.com/t/privateurls/a`
  // satisfied the regex and the server then fetched the attacker's host.
  if (!isPrivateUrl(parse.data.url)) {
    return NextResponse.json({ error: 'not_a_private_url' }, { status: 400 });
  }
  const urlVariants = privateUrlVariants(parse.data.url);
  try {
    const result = await ingestPrivateUrl(parse.data.url, session.user.id, {
      force: parse.data.force,
    });
    // Reconcile any IngestJob row so the dashboard doesn't show stale pending/failed.
    // Store parse warnings in lastError even on success so the dashboard can surface
    // "Done but 0 teams — vueData columns=[...]" without a separate DB field.
    await prisma.ingestJob.updateMany({
      where: { userId: session.user.id, url: { in: urlVariants } },
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
    // Deadlock-class failures (PG 40P01, Prisma P2034, withDeadlockRetry
    // exhaustion) are transient by definition — postgres aborts whichever
    // tx loses the race and a retry would have succeeded. Reschedule the
    // job back to pending with bumped scheduledAt so the cron picks it
    // up; the user gets a 503 with a clear hint instead of a stuck
    // "failed" status that requires manual Retry.
    if (isDeadlockError(err)) {
      await prisma.ingestJob.updateMany({
        where: { userId: session.user.id, url: { in: urlVariants } },
        data: {
          status: IngestJobStatus.pending,
          startedAt: null,
          finishedAt: null,
          scheduledAt: new Date(),
          lastError: msg.slice(0, 2000),
        },
      });
      return NextResponse.json(
        {
          error: 'transient_deadlock',
          hint: 'Two ingests collided on shared rows. The job is rescheduled and will retry shortly.',
        },
        { status: 503 },
      );
    }
    await prisma.ingestJob.updateMany({
      where: { userId: session.user.id, url: { in: urlVariants } },
      data: {
        status: IngestJobStatus.failed,
        finishedAt: new Date(),
        lastError: msg.slice(0, 2000),
      },
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
