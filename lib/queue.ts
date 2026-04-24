import { prisma } from '@/lib/db';
import { IngestJobStatus, Prisma } from '@prisma/client';

export async function enqueueUrl(userId: string, url: string): Promise<void> {
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
  const minutes = params.olderThanMinutes ?? 5;
  const interval = Prisma.sql`(NOW() - make_interval(mins => ${minutes}))`;
  if (params.userId) {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "IngestJob"
      SET "status" = 'pending', "startedAt" = NULL
      WHERE "userId" = ${params.userId}
        AND "status" = 'running'
        AND ("startedAt" IS NULL OR "startedAt" < ${interval})
    `);
  } else {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "IngestJob"
      SET "status" = 'pending', "startedAt" = NULL
      WHERE "status" = 'running'
        AND ("startedAt" IS NULL OR "startedAt" < ${interval})
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
  await prisma.ingestJob.update({
    where: { id },
    data: { status: IngestJobStatus.done, finishedAt: new Date(), lastError: null },
  });
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
