import { cache } from 'react';
import { prisma } from '@/lib/db';
import { getAccuracyOverview, type Band } from '@/lib/admin/accuracy';
import { countInbox, listInbox } from '@/lib/admin/inbox';
import { band } from '@/lib/audit/score';
import { orNull } from '@/lib/admin/orNull';

/**
 * The inbox page, read once per request. The summary line (above every tab)
 * and the Inbox panel both need it, and a read is a scan of every source.
 */
export const readInbox = cache((page: number) => listInbox({ page }));

/**
 * The full accuracy overview, read once per request. Only the Tournaments tab
 * needs it (the summary line has its own count-only read below), and its
 * panel and any other caller on the same render share the one read.
 */
export const readOverview = cache(() => getAccuracyOverview());

/**
 * Band counts and the weighted database score from the audits' (score,
 * usersAffected) pairs, grouped in SQL: at most a few hundred groups come
 * back however many audits exist, and the checks JSON is never read. The
 * bands and the weighting are the ledger's own (band() and the 1 + users
 * weight of databaseScore), so the line and the tab cannot disagree.
 */
const readAccuracyCounts = cache(async () => {
  const groups = await prisma.tournamentAudit.groupBy({
    by: ['score', 'usersAffected'],
    _count: { _all: true },
  });
  const bands: Record<Band, number> = { good: 0, check: 0, rescrape: 0 };
  let weightedSum = 0;
  let weightTotal = 0;
  for (const g of groups) {
    const n = g._count._all;
    bands[band(g.score)] += n;
    const w = 1 + g.usersAffected;
    weightedSum += g.score * w * n;
    weightTotal += w * n;
  }
  return { score: weightTotal === 0 ? null : Math.round(weightedSum / weightTotal), ...bands };
});

/** The inbox's per-kind counts, read once per request without building items. */
const readInboxCounts = cache(() => countInbox());

/**
 * The figures of the line above the tabs. Each is null when its read failed:
 * the line then shows a dash for that figure and still renders, as every
 * other /admin section does.
 */
export type Summary = {
  /** Open inbox items. */
  needsYou: number | null;
  accuracy: { score: number | null; good: number; check: number; rescrape: number } | null;
  /** Failed imports whose tournament is not stored and no mark covers. */
  importsFailing: number | null;
  /** Jobs waiting to be ingested. */
  queue: number | null;
};

export async function getSummary(): Promise<Summary> {
  const [counts, accuracy, queue] = await Promise.all([
    readInboxCounts().catch(orNull('summary inbox')),
    readAccuracyCounts().catch(orNull('summary accuracy')),
    prisma.ingestJob.count({ where: { status: 'pending' } }).catch(orNull('summary queue')),
  ]);
  return {
    needsYou: counts ? Object.values(counts).reduce((a, b) => a + b, 0) : null,
    accuracy,
    importsFailing: counts ? counts.import : null,
    queue,
  };
}
