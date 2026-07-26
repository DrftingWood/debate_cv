import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { ingestPrivateUrl, isDeadlockError } from '@/lib/calicotab/ingest';
import { pruneIngestArtifacts } from '@/lib/calicotab/provenance';
import { pruneRateLimits } from '@/lib/rateLimit';
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
    const started = Date.now();
    const results: Array<{ id: string; status: 'done' | 'failed' | 'abandoned' | 'retry'; error?: string }> = [];

    await resetStuckRunning({});

    let stoppedForBudget = false;
    while (true) {
      if (Date.now() - started >= TIME_BUDGET_MS - JOB_HEADROOM_MS) {
        stoppedForBudget = true;
        break;
      }
      const job = await claimOnePending();
      if (!job) break;

      /*
       * A job can only arrive above the attempt ceiling by having been
       * claimed and then killed mid-ingest — the graceful failure paths all
       * terminate at MAX_ATTEMPTS inside the catch below. Left alone it
       * would retry forever at the head of the queue. Fail it here, before
       * spending another invocation on it, and report it: a job that
       * consistently outlives the function budget is a real operational
       * problem (usually a tab page that has grown past what a 60s
       * serverless invocation can parse) and needs a human, not a retry.
       */
      if (job.attempts > MAX_ATTEMPTS) {
        const msg = `Exceeded ${MAX_ATTEMPTS} attempts without completing — the ingest does not fit in the function time budget.`;
        Sentry.captureException(new Error(msg), {
          tags: { route: 'api/cron/process-queue', stage: 'ingest-budget-exhausted' },
          extra: { url: job.url, attempts: job.attempts },
          user: { id: job.userId },
        });
        await markJobFailed(job.id, msg);
        results.push({ id: job.id, status: 'failed', error: msg });
        continue;
      }

      try {
        await ingestPrivateUrl(job.url, job.userId);
        await markJobDone(job.id);
        results.push({ id: job.id, status: 'done' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Deadlock-class failures are transient by definition (postgres
        // aborts the loser of a write race) — always reschedule, never
        // hard-fail, even past MAX_ATTEMPTS. See audit issue #8.
        if (isDeadlockError(err)) {
          await rescheduleJob(job.id, msg);
          results.push({ id: job.id, status: 'retry', error: msg });
        } else if (isPermanentError(msg)) {
          // Fast-fail to terminal `abandoned` on first attempt — the landing
          // page returned 404 (dead Heroku app, removed tournament). No
          // recovery path exists, so we skip the 2 remaining retries and
          // report immediately (this IS the final attempt by design).
          Sentry.captureException(err, {
            tags: { route: 'api/cron/process-queue', stage: 'ingest-abandoned' },
            extra: { url: job.url, attempts: job.attempts },
            user: { id: job.userId },
          });
          await markJobAbandoned(job.id, msg);
          results.push({ id: job.id, status: 'abandoned', error: msg });
        } else if (job.attempts >= MAX_ATTEMPTS) {
          // Only report on the FINAL attempt — earlier attempts are expected
          // to occasionally fail (Cloudflare flakes, slow Tabbycat hosts).
          // Reporting every retry would noise up Sentry without surfacing
          // anything actionable.
          Sentry.captureException(err, {
            tags: { route: 'api/cron/process-queue', stage: 'ingest-failed-final' },
            extra: { url: job.url, attempts: job.attempts },
            user: { id: job.userId },
          });
          await markJobFailed(job.id, msg);
          results.push({ id: job.id, status: 'failed', error: msg });
        } else {
          await rescheduleJob(job.id, msg);
          results.push({ id: job.id, status: 'retry', error: msg });
        }
      }
    }

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
      processed: results.length,
      results,
      pruned,
      stoppedForBudget,
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
