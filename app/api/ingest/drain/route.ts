import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ingestPrivateUrl } from '@/lib/calicotab/ingest';
import { IngestJobStatus, Prisma } from '@prisma/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 8;
const TIME_BUDGET_MS = 50_000;

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;
  const started = Date.now();
  const results: Array<{ url: string; status: 'done' | 'failed' | 'retry'; error?: string }> = [];

  while (Date.now() - started < TIME_BUDGET_MS) {
    const claimed = await prisma.$queryRaw<Array<{ id: string; url: string; attempts: number }>>(
      Prisma.sql`
        UPDATE "IngestJob"
        SET "status" = 'running', "attempts" = "attempts" + 1, "startedAt" = NOW()
        WHERE "id" IN (
          SELECT "id" FROM "IngestJob"
          WHERE "userId" = ${userId} AND "status" = 'pending'
          ORDER BY "scheduledAt" ASC
          FOR UPDATE SKIP LOCKED
          LIMIT ${BATCH_SIZE}
        )
        RETURNING "id", "url", "attempts"
      `,
    );
    if (claimed.length === 0) break;

    for (const job of claimed) {
      try {
        await ingestPrivateUrl(job.url, userId);
        await prisma.ingestJob.update({
          where: { id: job.id },
          data: { status: IngestJobStatus.done, finishedAt: new Date(), lastError: null },
        });
        results.push({ url: job.url, status: 'done' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (job.attempts >= MAX_ATTEMPTS) {
          await prisma.ingestJob.update({
            where: { id: job.id },
            data: {
              status: IngestJobStatus.failed,
              finishedAt: new Date(),
              lastError: msg.slice(0, 2000),
            },
          });
          results.push({ url: job.url, status: 'failed', error: msg });
        } else {
          await prisma.ingestJob.update({
            where: { id: job.id },
            data: { status: IngestJobStatus.pending, startedAt: null, lastError: msg.slice(0, 2000) },
          });
          results.push({ url: job.url, status: 'retry', error: msg });
        }
      }
      if (Date.now() - started >= TIME_BUDGET_MS) break;
    }
  }

  const remaining = await prisma.ingestJob.count({
    where: { userId, status: IngestJobStatus.pending },
  });

  return NextResponse.json({
    processed: results.length,
    remaining,
    results,
  });
}
