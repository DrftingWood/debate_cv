import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// How far back a finished job still counts as part of the "current batch".
// The queue has no batch concept — jobs just accumulate — so the tracker
// frames progress as "everything that finished recently plus everything
// still queued". An hour comfortably covers a Gmail-scan burst being
// drained by the 15-minute ticks without dragging in yesterday's history.
const BATCH_WINDOW_MS = 60 * 60 * 1000;

// Fallback per-job estimate when there's no recent history to average:
// a full scrape is ~40s (see ESTIMATED_JOB_MS in the drain route); cache
// hits are ~2s. Without data we assume scrapes — overestimating an ETA
// is friendlier than blowing past it.
const DEFAULT_JOB_SECONDS = 40;

export type IngestProgressScope = {
  pending: number;
  running: number;
  doneRecent: number;
  failedRecent: number;
  /** Batch frame: doneRecent + failedRecent + running + pending. */
  batchTotal: number;
  /** URL of the longest-running in-flight job, for the "now processing" line. */
  currentUrl: string | null;
  currentStartedAt: string | null;
  /** Mean wall-clock seconds of the last 20 completed jobs; null = no history. */
  avgJobSeconds: number | null;
  /** Rough seconds until the queue is empty; null when nothing is queued. */
  etaSeconds: number | null;
};

async function buildScope(userId: string | null): Promise<IngestProgressScope> {
  const userWhere = userId ? { userId } : {};
  const windowStart = new Date(Date.now() - BATCH_WINDOW_MS);

  const [pending, running, doneRecent, failedRecent, currentJob, recentDone] =
    await Promise.all([
      prisma.ingestJob.count({ where: { ...userWhere, status: 'pending' } }),
      prisma.ingestJob.count({ where: { ...userWhere, status: 'running' } }),
      prisma.ingestJob.count({
        where: { ...userWhere, status: 'done', finishedAt: { gte: windowStart } },
      }),
      prisma.ingestJob.count({
        where: {
          ...userWhere,
          status: { in: ['failed', 'abandoned'] },
          finishedAt: { gte: windowStart },
        },
      }),
      prisma.ingestJob.findFirst({
        where: { ...userWhere, status: 'running' },
        orderBy: { startedAt: 'asc' },
        select: { url: true, startedAt: true },
      }),
      // Duration sample for the ETA. Includes cache-hit jobs (~2s) and
      // full scrapes (~40s) alike, so the average self-calibrates to
      // whatever mix the queue is actually processing right now.
      prisma.ingestJob.findMany({
        where: {
          ...userWhere,
          status: 'done',
          startedAt: { not: null },
          finishedAt: { not: null },
        },
        orderBy: { finishedAt: 'desc' },
        take: 20,
        select: { startedAt: true, finishedAt: true },
      }),
    ]);

  const durations = recentDone
    .map((j) => (j.finishedAt!.getTime() - j.startedAt!.getTime()) / 1000)
    .filter((s) => s >= 0 && s < 600);
  const avgJobSeconds = durations.length
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : null;

  const active = pending + running;
  let etaSeconds: number | null = null;
  if (active > 0) {
    const perJob = avgJobSeconds ?? DEFAULT_JOB_SECONDS;
    etaSeconds = Math.round(pending * perJob);
    // Credit the in-flight job for the time it has already spent.
    if (running > 0) {
      const elapsed = currentJob?.startedAt
        ? (Date.now() - currentJob.startedAt.getTime()) / 1000
        : 0;
      etaSeconds += Math.round(Math.max(perJob - elapsed, 5) * running);
    }
    etaSeconds = Math.max(etaSeconds, 5);
  }

  return {
    pending,
    running,
    doneRecent,
    failedRecent,
    batchTotal: pending + running + doneRecent + failedRecent,
    currentUrl: currentJob?.url ?? null,
    currentStartedAt: currentJob?.startedAt?.toISOString() ?? null,
    avgJobSeconds: avgJobSeconds != null ? Math.round(avgJobSeconds * 10) / 10 : null,
    etaSeconds,
  };
}

/**
 * Polling endpoint behind the ingest progress trackers (dashboard = the
 * caller's own queue, /admin = everyone's). COUNT-cheap by design, same
 * philosophy as /api/cv/status: the pollers hit this every few seconds
 * while a drain is running, so it must never touch buildCvData-scale
 * queries. `global` is included only for allowlisted admins.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  let isAdmin = false;
  try {
    await requireAdmin();
    isAdmin = true;
  } catch {
    // Not an admin — user scope only.
  }

  const [user, global] = await Promise.all([
    buildScope(session.user.id),
    isAdmin ? buildScope(null) : Promise.resolve(null),
  ]);

  return NextResponse.json({ user, global });
}
