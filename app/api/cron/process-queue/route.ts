import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { ingestPrivateUrl } from '@/lib/calicotab/ingest';
import {
  claimOnePending,
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
    const results: Array<{ id: string; status: 'done' | 'failed' | 'retry'; error?: string }> = [];

    await resetStuckRunning({});

    while (Date.now() - started < TIME_BUDGET_MS) {
      const job = await claimOnePending();
      if (!job) break;

      try {
        await ingestPrivateUrl(job.url, job.userId);
        await markJobDone(job.id);
        results.push({ id: job.id, status: 'done' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Only report on the FINAL attempt — earlier attempts are expected
        // to occasionally fail (Cloudflare flakes, slow Tabbycat hosts).
        // Reporting every retry would noise up Sentry without surfacing
        // anything actionable.
        if (job.attempts >= MAX_ATTEMPTS) {
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

    return NextResponse.json({ processed: results.length, results });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/cron/process-queue]', msg);
    // Top-level cron failures (e.g. claim-loop crash, DB connection death)
    // are always actionable — they typically mean queue draining is stuck.
    Sentry.captureException(err, { tags: { route: 'api/cron/process-queue', stage: 'top-level' } });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
