import { after, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { ingestPrivateUrl, isDeadlockError } from '@/lib/calicotab/ingest';
import { isIngestDeadlineError } from '@/lib/calicotab/fetchSession';
import { pruneIngestArtifacts, prunePlaceholderPersons } from '@/lib/calicotab/provenance';
import { pruneRateLimits } from '@/lib/rateLimit';
import { resetStuckRunning } from '@/lib/queue';
import { drainQueue, DRAIN_CONCURRENCY } from '@/lib/queueDrain';
import { prisma } from '@/lib/db';
import { revokeAndForgetGmailToken } from '@/lib/gmail/client';
import { isRefreshTokenInvalid } from '@/lib/gmail/errors';
import { scanDueMailboxes } from '@/lib/gmail/backgroundScan';
import { scanMailbox } from '@/lib/gmail/scanUser';
import { retryDuePieces } from '@/lib/calicotab/partialScrape';
import { auditStale } from '@/lib/audit/run';

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
 * Headroom alone was not enough: a job may START with 30s left, but a
 * WUDC-scale ingest runs 45-51s (measured locally, 2026-10), so a big job
 * claimed at t=25s was still killed at 60s. Every job now also carries a
 * deadline at the end of TIME_BUDGET_MS (lib/queueDrain.ts): it stops itself
 * before writing anything when time runs short, and a job that was merely
 * started late goes back to the head of the queue without spending an
 * attempt, to run first — with the whole budget — on the next tick.
 *
 * Starting a job with less than this left is knowingly starting one that
 * will probably be deferred — better to end the tick.
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

/*
 * `?respond=early`: answer 202 at once and drain after the response.
 *
 * External schedulers give up on a slow response — cron-job.org at 30s, so a
 * tick that drains for up to 55s showed as a failed run (10 of 30 while a
 * backlog cleared), and cron-job.org disables a job after enough failures in
 * a row. The drain itself was never interrupted: the response, not the
 * work, was late. With this flag the drain runs in after(), which Vercel
 * keeps alive up to maxDuration, so the budget and deadlines are unchanged;
 * the caller just stops waiting for the JSON report. The Vercel cron and the
 * GitHub Actions drain, which wait up to 90s and print the report, keep the
 * default synchronous behaviour.
 */
function respondEarly(req: Request): boolean {
  return new URL(req.url).searchParams.get('respond') === 'early';
}

async function handle(req: Request) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (respondEarly(req)) {
    after(async () => {
      // Once the 202 is sent nobody reads this response, so a failure here
      // must reach Sentry or it is invisible. runOnce reports its own errors;
      // this catches anything thrown around it.
      try {
        await runOnce();
      } catch (err) {
        Sentry.captureException(err, { tags: { route: 'api/cron/process-queue', stage: 'after' } });
      }
    });
    return NextResponse.json({ accepted: true }, { status: 202 });
  }
  return runOnce();
}

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

/*
 * Background Gmail scan, before the drain so what it finds is ingested in the
 * same tick. Each user is scanned about every BACKGROUND_SCAN_INTERVAL_MIN
 * (default 30) minutes, two users a tick at most, and the whole step is held to
 * SCAN_BUDGET_MS so the drain keeps nearly all of the tick. Switch it off with
 * BACKGROUND_GMAIL_SCAN=0. The privacy page tells users it happens.
 */
const SCAN_BUDGET_MS = 12_000;
const SCAN_MAX_USERS = 2;

async function runBackgroundScan() {
  if (process.env.BACKGROUND_GMAIL_SCAN === '0') return null;
  const minutes = Number(process.env.BACKGROUND_SCAN_INTERVAL_MIN);
  const intervalMs = (Number.isFinite(minutes) && minutes >= 5 ? minutes : 30) * 60_000;
  return scanDueMailboxes(
    {
      findDue: async (olderThan, limit) => {
        const rows = await prisma.gmailToken.findMany({
          where: { OR: [{ lastScannedAt: null }, { lastScannedAt: { lt: olderThan } }] },
          orderBy: { lastScannedAt: { sort: 'asc', nulls: 'first' } },
          take: limit,
          select: { userId: true },
        });
        return rows.map((r) => r.userId);
      },
      scan: scanMailbox,
      isGrantGone: isRefreshTokenInvalid,
      forgetGrant: revokeAndForgetGmailToken,
      markAttempted: async (userId) => {
        await prisma.gmailToken.update({ where: { userId }, data: { lastScannedAt: new Date() } });
      },
      onError: (err, userId) => {
        Sentry.captureException(err, {
          tags: { route: 'api/cron/process-queue', stage: 'gmail-scan' },
          user: { id: userId },
        });
      },
    },
    { intervalMs, maxUsers: SCAN_MAX_USERS, budgetMs: SCAN_BUDGET_MS },
  );
}

// A scan failure must never stop the drain.
async function scanSafely() {
  try {
    return await runBackgroundScan();
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'api/cron/process-queue', stage: 'gmail-scan' },
    });
    return null;
  }
}

/*
 * Failed pieces of stored tournaments retry here, after the drain so new
 * imports keep priority. They share the drain's TIME_BUDGET_MS from the tick's
 * start; retryDuePieces starts no tournament without 20s left. A failure here
 * is reported and never fails the tick.
 */
async function retryPiecesSafely(startedAt: number) {
  try {
    return await retryDuePieces({ deadline: startedAt + TIME_BUDGET_MS });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'api/cron/process-queue', stage: 'piece-retry' },
    });
    return null;
  }
}

/*
 * Data-accuracy audits of tournaments with none, or one older than a day or
 * from an older CHECKS_VERSION: up to AUDIT_MAX a tick, last, so imports and
 * piece retries keep priority, within the same TIME_BUDGET_MS. Every scrape
 * write already audits its tournament; this sweep covers what that misses
 * (the backlog, a failed after-scrape audit, a rule change). A failure here is
 * reported and never fails the tick.
 */
const AUDIT_MAX = 50;
// auditStale only checks its deadline before each chunk, so the last chunk
// must be able to start this long before the tick's budget ends and finish.
const AUDIT_CHUNK_HEADROOM_MS = 5_000;

async function auditSafely(startedAt: number) {
  try {
    const deadline = startedAt + TIME_BUDGET_MS - AUDIT_CHUNK_HEADROOM_MS;
    return await auditStale({ limit: AUDIT_MAX, deadline });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: 'api/cron/process-queue', stage: 'audit' },
    });
    return null;
  }
}

async function runOnce() {
  const startedAt = Date.now();
  try {
    await resetStuckRunning({});

    const scan = await scanSafely();

    const report = await drainQueue(
      {
        ingest: (url, userId, { deadline }) => ingestPrivateUrl(url, userId, { deadline }),
        isDeadlockError,
        isDeadlineError: isIngestDeadlineError,
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
    const piecesRetried = await retryPiecesSafely(startedAt);
    const audited = await auditSafely(startedAt);

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
        // Stand-in Persons made by a path that should not have made them —
        // see prunePlaceholderPersons.
        await prunePlaceholderPersons();
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
      scan,
      pruned,
      piecesRetried,
      audited,
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
