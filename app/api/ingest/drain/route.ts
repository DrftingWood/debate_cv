import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ingestPrivateUrl, isDeadlockError } from '@/lib/calicotab/ingest';
import { IngestJobStatus } from '@prisma/client';
import {
  claimOnePending,
  isPermanentError,
  markJobAbandoned,
  markJobDone,
  markJobFailed,
  rescheduleJob,
  resetStuckRunning,
} from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Hobby cap. The bulk-write speedup in lib/calicotab/ingest.ts keeps a
// single WUDC-scale ingest comfortably under this.
export const maxDuration = 60;

const MAX_ATTEMPTS = 3;
const TIME_BUDGET_MS = 50_000;
// Conservative estimate of one ingest's wall-clock cost at the current
// per-host throttle (lib/calicotab/fetch.ts MIN_INTERVAL_MS = 1500ms):
//   ~16 same-host fetches × 1.5s throttle  = 24s
//   + fetch latency (median ~0.3s × 16)    = ~5s
//   + parse + bulk DB writes               = ~5-10s
//   ≈ 35-40s
// We use 40s so the budget pre-check below never claims a job we can't
// finish before Vercel's 60s function limit kills the lambda mid-write
// (which previously left jobs stuck in "running" until the cron's
// resetStuckRunning call cleaned them up).
const ESTIMATED_JOB_MS = 40_000;

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    const started = Date.now();
    const results: Array<{ url: string; status: 'done' | 'failed' | 'abandoned' | 'retry'; error?: string }> = [];

    await resetStuckRunning({ userId });

    while (Date.now() - started < TIME_BUDGET_MS) {
      // Don't START another job we can't finish in the remaining budget.
      // First iteration always proceeds (results.length === 0) so a single
      // drain call never returns a no-op even when budget is tight — the
      // client-side drainUntilEmpty loop relies on that to make progress.
      const remaining = TIME_BUDGET_MS - (Date.now() - started);
      if (results.length > 0 && remaining < ESTIMATED_JOB_MS) break;
      const job = await claimOnePending({ userId });
      if (!job) break;

      try {
        await ingestPrivateUrl(job.url, userId);
        await markJobDone(job.id);
        results.push({ url: job.url, status: 'done' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Deadlock-class failures are transient by definition (postgres
        // aborts the loser of a write race) — always reschedule, never
        // hard-fail, even past MAX_ATTEMPTS. The audit (#8) flagged that
        // a busy queue could deadlock-exhaust 5/5 retries in
        // withDeadlockRetry and then bubble up to a markJobFailed,
        // requiring manual user intervention.
        if (isDeadlockError(err)) {
          await rescheduleJob(job.id, msg);
          results.push({ url: job.url, status: 'retry', error: msg });
        } else if (isPermanentError(msg)) {
          // Fast-fail to terminal `abandoned` — no point retrying 2 more times
          // when the landing page returned 404 (dead Heroku app, removed
          // tournament). Saves 2 cron cycles per dead URL and keeps the
          // actionable-failed count accurate.
          await markJobAbandoned(job.id, msg);
          results.push({ url: job.url, status: 'abandoned', error: msg });
        } else if (job.attempts >= MAX_ATTEMPTS) {
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
