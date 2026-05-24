import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { IngestJobStatus } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Bulk reset of every failed IngestJob for the current user back to
 * pending. Mirrors the per-URL /api/ingest/clear behaviour but in one
 * trip — drives the dashboard's "Retry all failed" chip-level bulk
 * action.
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  // All `failed` jobs are now retriable — permanently-dead URLs (HTTP 404
  // on landing) are routed to the `abandoned` terminal status instead and
  // don't show up here. See lib/queue.ts:isPermanentError.
  const failedJobs = await prisma.ingestJob.findMany({
    where: { userId, status: IngestJobStatus.failed },
    select: { url: true },
  });

  const recoverable = failedJobs.map((j) => j.url);

  if (recoverable.length === 0) {
    return NextResponse.json({ retried: 0, skipped: 0 });
  }

  const result = await prisma.$transaction([
    prisma.ingestJob.updateMany({
      where: { userId, url: { in: recoverable } },
      data: {
        status: IngestJobStatus.pending,
        attempts: 0,
        lastError: null,
        startedAt: null,
        finishedAt: null,
      },
    }),
    prisma.discoveredUrl.updateMany({
      where: { userId, url: { in: recoverable } },
      data: {
        ingestedAt: null,
        tournamentId: null,
        registrationPersonId: null,
        registrationName: null,
      },
    }),
  ]);

  return NextResponse.json({
    retried: result[0].count,
    skipped: 0,
  });
}
