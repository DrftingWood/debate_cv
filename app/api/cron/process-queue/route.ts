import { NextResponse } from 'next/server';
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
export const maxDuration = 60;

const MAX_ATTEMPTS = 3;
const TIME_BUDGET_MS = 55_000;

function isAuthorized(req: Request): boolean {
  // Vercel signs cron requests with x-vercel-cron: 1.
  if (req.headers.get('x-vercel-cron') === '1') return true;
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get('authorization') || req.headers.get('x-cron-secret');
  if (header === `Bearer ${secret}` || header === secret) return true;
  return false;
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
  const started = Date.now();
  const results: Array<{ id: string; status: 'done' | 'failed' | 'retry'; error?: string }> = [];

  // Recover stuck 'running' rows from any prior invocation.
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
      if (job.attempts >= MAX_ATTEMPTS) {
        await markJobFailed(job.id, msg);
        results.push({ id: job.id, status: 'failed', error: msg });
      } else {
        await rescheduleJob(job.id, msg);
        results.push({ id: job.id, status: 'retry', error: msg });
      }
    }
  }

  return NextResponse.json({ processed: results.length, results });
}
