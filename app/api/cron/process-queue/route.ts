import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { ingestPrivateUrl, isDeadlockError } from '@/lib/calicotab/ingest';
import { pruneIngestArtifacts } from '@/lib/calicotab/provenance';
import { pruneRateLimits } from '@/lib/rateLimit';
import { resetStuckRunning } from '@/lib/queue';
import { drainQueue, DRAIN_CONCURRENCY } from '@/lib/queueDrain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// Hobby cap. Bulk-write speedup keeps a single WUDC-scale ingest under
// this; multi-job cron ticks rely on the per-iteration time budget below.
export const maxDuration = 60;

const MAX_ATTEMPTS = 3;
const TIME_BUDGET_MS = 55_000;

/*
 * Headroom reserved for the job we are about to start.
 *
 * The loop used to test only "is there budget left?" and then start an
 * ingest that can take half a minute on a WUDC-scale tab. A job claimed at
 * t=54s ran until the platform killed the function at maxDuration, so
 * neither markJobDone nor any catch branch executed: the job stayed
 * `running`, was recovered to `pending` by resetStuckRunning, and came back
 * for another doomed attempt. Nothing ever marked it failed, because the
 * attempt-limit check lives in the catch a killed function never reaches.
 *
 * 30s is the observed worst case for a large tournament plus its writes.
 * Starting a job with less than that left is knowingly starting one we
 * cannot finish — better to end the tick and let the next one have a full
 * budget.
 */
const JOB_HEADROOM_MS = 30_000;


function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return timingSafeEqual(aBuf, bBuf);
}

function isAuthorized(req: Request): boolean {
  // Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically when
  // the project has CRON_SECRET configured. x-cron-secret is for manual probes.
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') || req.headers.get('x-cron-secret') || '';
  return safeEqual(header, `Bearer ${secret}`) || safeEqual(header, secret);
}

export async function GET(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return runOnce();
}

export async function POST(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  return runOnce();
}

async function runOnce() {
  try {
    await resetStuckRunning({});

    const report = await drainQueue(
      {
        ingest: (url, userId) => ingestPrivateUrl(url, userId),
        isDeadlockError,
        onTerminal: (stage, err, job) => {
          Sentry.captureException(err, {
            tags: { route: 'api/cron/process-queue', stage },
            extra: { url: job.url, attempts: job.attempts },
            user: { id: job.userId },
          });
        },
      },
      {
        budgetMs: TIME_BUDGET_MS,
        headroomMs: JOB_HEADROOM_MS,
        maxAttempts: MAX_ATTEMPTS,
        concurrency: DRAIN_CONCURRENCY,
      },
    );
    const { results, stoppedForBudget } = report;

    // Retention pass for pipeline history (superseded SourceDocument
    // snapshots + stale ParserRuns). Gated to the 03:00 UTC hour: this
    // endpoint is now hit every ~15 minutes by the GitHub Actions drain
    // (.github/workflows/drain-queue.yml) on top of the daily Vercel
    // cron (which fires at 03:00 — see vercel.json), and the ParserRun
    // delete scans an unindexed createdAt; once a day is plenty. Any
    // invocation during that hour prunes — the deletes are idempotent.
    // Best-effort: a prune failure is Sentry-worthy but must not fail
    // the drain response.
    let pruned: { sourceDocumentsDeleted: number; parserRunsDeleted: number } | null = null;
    if (new Date().getUTCHours() === 3) {
      try {
        pruned = await pruneIngestArtifacts();
        // Rate-limit counters expire in place, but abandoned keys (a user
        // who used a route once and never again) would otherwise persist
        // forever — one row per (route, user) pair.
        await pruneRateLimits();
      } catch (err) {
        Sentry.captureException(err, {
          tags: { route: 'api/cron/process-queue', stage: 'prune' },
        });
      }
    }

    // `stoppedForBudget` tells the caller the queue was NOT drained — the
    // tick ran out of time with work still pending. Without it a caller
    // (or a human reading the JSON) cannot tell a finished queue from a
    // truncated one, which is exactly the state worth alerting on.
    return NextResponse.json({
      processed: report.processed,
      results,
      pruned,
      stoppedForBudget,
      peakInFlight: report.peakInFlight,
      elapsedMs: report.elapsedMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/cron/process-queue]', msg);
    // Top-level cron failures (e.g. claim-loop crash, DB connection death)
    // are always actionable — they typically mean queue draining is stuck.
    Sentry.captureException(err, { tags: { route: 'api/cron/process-queue', stage: 'top-level' } });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
