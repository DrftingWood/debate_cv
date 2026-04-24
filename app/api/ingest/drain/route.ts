import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ingestPrivateUrl } from '@/lib/calicotab/ingest';
import { IngestJobStatus } from '@prisma/client';
import {
  claimOnePending,
  markJobDone,
  markJobFailed,
  rescheduleJob,
  resetStuckRunning,
} from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_ATTEMPTS = 3;
const TIME_BUDGET_MS = 50_000;

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    const started = Date.now();
    const results: Array<{ url: string; status: 'done' | 'failed' | 'retry'; error?: string }> = [];

    await resetStuckRunning({ userId });

    while (Date.now() - started < TIME_BUDGET_MS) {
      const job = await claimOnePending({ userId });
      if (!job) break;

      try {
        await ingestPrivateUrl(job.url, userId);
        await markJobDone(job.id);
        results.push({ url: job.url, status: 'done' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (job.attempts >= MAX_ATTEMPTS) {
          await markJobFailed(job.id, msg);
          results.push({ url: job.url, status: 'failed', error: msg });
        } else {
          await rescheduleJob(job.id, msg);
          results.push({ url: job.url, status: 'retry', error: msg });
        }
      }
    }

    const remaining = await prisma.ingestJob.count({
      where: { userId, status: IngestJobStatus.pending },
    });

    return NextResponse.json({ processed: results.length, remaining, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/ingest/drain]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
