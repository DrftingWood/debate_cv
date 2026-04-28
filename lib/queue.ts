import { prisma } from '@/lib/db';
import { IngestJobStatus, Prisma } from '@prisma/client';

export async function enqueueUrl(userId: string, url: string): Promise<void> {
  const locked = await prisma.discoveredUrl.findUnique({
    where: { userId_url: { userId, url } },
    select: { reingestLocked: true },
  });
  if (locked?.reingestLocked) return;

  await prisma.ingestJob.updateMany({
    where: { userId, url, status: IngestJobStatus.failed },
    data: {
      status: IngestJobStatus.pending,
      attempts: 0,
      lastError: null,
      startedAt: null,
      finishedAt: null,
      scheduledAt: new Date(),
    },
  });
  await prisma.ingestJob.upsert({
    where: { userId_url: { userId, url } },
    update: {},
    create: { userId, url, status: IngestJobStatus.pending },
  });
}

/**
 * Reclaim jobs that were marked 'running' but whose worker never finished
 * (killed mid-run, deploy cycled, time budget exceeded). Belt-and-suspenders
 * recovery that runs at the start of every drain + cron invocation.
 */
export async function resetStuckRunning(params: { userId?: string; olderThanMinutes?: number } = {}) {
  // Multiply an int-cast parameter by a constant INTERVAL instead of calling
  // make_interval(). Prisma serializes JS numbers as BIGINT, which make_interval
  // rejects with "function make_interval(mins => bigint) does not exist".
  const minutes = Math.max(0, Math.floor(params.olderThanMinutes ?? 5));
  const threshold = Prisma.sql`(NOW() - (${minutes}::int * INTERVAL '1 minute'))`;
  if (params.userId) {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "IngestJob"
      SET "status" = 'pending', "startedAt" = NULL
      WHERE "userId" = ${params.userId}
        AND "status" = 'running'
        AND ("startedAt" IS NULL OR "startedAt" < ${threshold})
    `);
  } else {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "IngestJob"
      SET "status" = 'pending', "startedAt" = NULL
      WHERE "status" = 'running'
        AND ("startedAt" IS NULL OR "startedAt" < ${threshold})
    `);
  }
}

/** Atomically claim a single pending job. Returns null when queue is empty. */
export async function claimOnePending(
  params: { userId?: string } = {},
): Promise<{ id: string; userId: string; url: string; attempts: number } | null> {
  const whereUser = params.userId
    ? Prisma.sql`AND "userId" = ${params.userId}`
    : Prisma.sql``;
  const rows = await prisma.$queryRaw<Array<{ id: string; userId: string; url: string; attempts: number }>>(
    Prisma.sql`
      UPDATE "IngestJob"
      SET "status" = 'running', "attempts" = "attempts" + 1, "startedAt" = NOW()
      WHERE "id" = (
        SELECT "id" FROM "IngestJob"
        WHERE "status" = 'pending' ${whereUser}
        ORDER BY "scheduledAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING "id", "userId", "url", "attempts"
    `,
  );
  return rows[0] ?? null;
}

export async function markJobDone(id: string): Promise<void> {
  const updated = await prisma.ingestJob.update({
    where: { id },
    data: { status: IngestJobStatus.done, finishedAt: new Date(), lastError: null },
    select: { userId: true },
  });
  // After this job finishes, was it the user's last pending/running one?
  // If so, surface a "your CV is ready" bell notification — closes the
  // post-onboarding loop for users who left the tab and came back later.
  // Best-effort + deduped, so back-to-back drains don't fire twice.
  const remaining = await prisma.ingestJob.count({
    where: {
      userId: updated.userId,
      status: { in: [IngestJobStatus.pending, IngestJobStatus.running] },
    },
  });
  if (remaining === 0) {
    const { writeNotification } = await import('@/lib/notifications/write');
    await writeNotification({
      userId: updated.userId,
      kind: 'ingest_done',
      title: 'Your CV is ready',
      body: 'All queued tournaments have been ingested.',
      href: '/cv',
      dedupeWithinMs: 60 * 1000,
    });
  }
}

export async function markJobFailed(id: string, error: string): Promise<void> {
  await prisma.ingestJob.update({
    where: { id },
    data: {
      status: IngestJobStatus.failed,
      finishedAt: new Date(),
      lastError: error.slice(0, 2000),
    },
  });
}

export async function rescheduleJob(id: string, error: string): Promise<void> {
  await prisma.ingestJob.update({
    where: { id },
    data: {
      status: IngestJobStatus.pending,
      startedAt: null,
      lastError: error.slice(0, 2000),
    },
  });
}
