import { NextResponse } from 'next/server';
import { claimPendingJobs, markJobDone, markJobFailed, rescheduleJob } from '@/lib/queue';
import { ingestPrivateUrl } from '@/lib/calicotab/ingest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const MAX_ATTEMPTS = 3;
const BATCH_SIZE = 5;

function isAuthorized(req: Request): boolean {
  // Vercel signs cron requests with x-vercel-cron: 1 and the CRON_SECRET env.
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
  const jobs = await claimPendingJobs(BATCH_SIZE);
  const results: Array<{ id: string; status: 'done' | 'failed' | 'retry'; error?: string }> = [];

  for (const job of jobs) {
    try {
      await ingestPrivateUrl(job.url, job.userId);
      await markJobDone(job.id);
      results.push({ id: job.id, status: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // The job was claimed with attempts+1, so current value is the attempt count including this one.
      // Re-read attempts to decide.
      const latest = await (await import('@/lib/db')).prisma.ingestJob.findUnique({
        where: { id: job.id },
        select: { attempts: true },
      });
      if ((latest?.attempts ?? MAX_ATTEMPTS) >= MAX_ATTEMPTS) {
        await markJobFailed(job.id, msg);
        results.push({ id: job.id, status: 'failed', error: msg });
      } else {
        await rescheduleJob(job.id, msg);
        results.push({ id: job.id, status: 'retry', error: msg });
      }
    }
  }

  return NextResponse.json({ processed: jobs.length, results });
}
