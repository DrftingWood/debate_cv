import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await requireAdmin();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  const [urls, skippedLocked] = await Promise.all([
    prisma.discoveredUrl.findMany({
      where: { reingestLocked: false },
      select: { userId: true, url: true, tournamentId: true },
    }),
    prisma.discoveredUrl.count({ where: { reingestLocked: true } }),
  ]);

  for (const { userId, url } of urls) {
    await prisma.ingestJob.upsert({
      where: { userId_url: { userId, url } },
      update: {
        status: 'pending',
        attempts: 0,
        lastError: null,
        startedAt: null,
        finishedAt: null,
        scheduledAt: new Date(),
      },
      create: { userId, url, status: 'pending' },
    });
  }

  // An ingest is served from cache while the stored tournament is fresh (30
  // days) and at the current parser version, and the queued jobs are plain
  // ingests, not forced ones. Without this, "Re-ingest all" finished in about
  // a second per tournament and re-fetched nothing: the motions fix never
  // reached any tournament already ingested. Marking them stale makes the
  // queued jobs do a real re-fetch (scrapedAt is reset by the ingest itself,
  // and nothing else reads it).
  const tournamentIds = [...new Set(urls.map((u) => u.tournamentId).filter((id): id is bigint => id != null))];
  if (tournamentIds.length > 0) {
    await prisma.tournament.updateMany({
      where: { id: { in: tournamentIds } },
      data: { scrapedAt: new Date(0) },
    });
  }

  return NextResponse.json({ queued: urls.length, skippedLocked });
}
