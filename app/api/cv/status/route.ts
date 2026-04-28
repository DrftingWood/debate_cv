import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Cheap polling endpoint that backs the CvNeedsAttentionBanners auto-refresh
 * loop. Returns just two integer counts so the banner can decide whether to
 * trigger a full router.refresh() (the expensive buildCvData rebuild) or
 * stay quiet.
 *
 * Why this exists: the previous implementation polled router.refresh()
 * every 8s while pending > 0. That runs the entire CV server component
 * — multiple Prisma queries, the highlights/aggregations, etc. — while
 * the database is also being hammered by the ingestion drain. On users
 * with many tournaments, the page-render latency exceeds 8s and
 * requests pile up; the tab feels frozen.
 *
 * Two cheap COUNT queries replace that. The banner triggers
 * router.refresh() only when the counts actually change (a job
 * completed, an unmatched got claimed, etc.).
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const [pendingCount, ingestedTournamentIds] = await Promise.all([
    prisma.ingestJob.count({
      where: { userId, status: { in: ['pending', 'running'] } },
    }),
    prisma.discoveredUrl.findMany({
      where: { userId, tournamentId: { not: null }, ingestedAt: { not: null } },
      select: { tournamentId: true },
      distinct: ['tournamentId'],
    }),
  ]);

  // Unmatched = tournaments the user has ingested but where they don't
  // appear as a TournamentParticipant (the speaker/judge tab parse
  // didn't match any of their claimed names). Mirrors the CV builder's
  // `unmatchedTournaments` derivation but at COUNT-only cost.
  let unmatchedCount = 0;
  if (ingestedTournamentIds.length > 0) {
    const tids = ingestedTournamentIds
      .map((u) => u.tournamentId)
      .filter((id): id is bigint => id != null);
    const matchedRows = await prisma.tournamentParticipant.findMany({
      where: {
        tournamentId: { in: tids },
        person: { claimedByUserId: userId },
      },
      select: { tournamentId: true },
      distinct: ['tournamentId'],
    });
    const matched = new Set(matchedRows.map((r) => r.tournamentId.toString()));
    for (const id of tids) {
      if (!matched.has(id.toString())) unmatchedCount += 1;
    }
  }

  return NextResponse.json({ pendingCount, unmatchedCount });
}
