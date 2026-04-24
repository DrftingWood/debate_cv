import { prisma } from '@/lib/db';
import { IngestJobStatus, Prisma } from '@prisma/client';

export async function enqueueUrl(userId: string, url: string): Promise<void> {
  await prisma.ingestJob.upsert({
    where: { userId_url: { userId, url } },
    update: {},
    create: { userId, url, status: IngestJobStatus.pending },
  });
}

export async function claimPendingJobs(limit: number) {
  // Raw SQL so we can use FOR UPDATE SKIP LOCKED and a single atomic claim.
  const rows = await prisma.$queryRaw<Array<{ id: string; userId: string; url: string }>>(
    Prisma.sql`
      UPDATE "IngestJob"
      SET "status" = 'running', "attempts" = "attempts" + 1, "startedAt" = NOW()
      WHERE "id" IN (
        SELECT "id" FROM "IngestJob"
        WHERE "status" = 'pending'
        ORDER BY "scheduledAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      RETURNING "id", "userId", "url"
    `,
  );
  return rows;
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
