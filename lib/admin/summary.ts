import { cache } from 'react';
import { prisma } from '@/lib/db';
import { getAccuracyOverview, type Band } from '@/lib/admin/accuracy';
import { countInbox, listInbox } from '@/lib/admin/inbox';
import { parseKinds, type InboxList } from '@/lib/admin/inboxTypes';
import { band } from '@/lib/audit/score';
import { orNull } from '@/lib/admin/orNull';

/**
 * The inbox page, read once per request. On the Inbox tab the summary line
 * and the panel both need it, and a read is a scan of every source, so both
 * go through here. `kinds` is the `?kinds=` words as written (a string, so
 * React's cache() can tell two reads apart by value).
 */
export const readInbox = cache((page: number, kinds: string) =>
  listInbox({ page, kinds: parseKinds(kinds) }),
);

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
    // Test and demo tournaments an admin set to ignored are not in the score.
    where: { tournament: { ignored: false } },
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

/**
 * The inbox's per-kind counts, read once per request without building items.
 * Used on every tab but the Inbox, whose own page read already carries them.
 * Only the accuracy count above avoids the audits' checks JSON: countInbox
 * still reads it (bounded at CANDIDATE_CAP audits) to tell which checks a
 * mark covers, it just builds no items.
 */
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

/**
 * `inbox` is the Inbox tab's own page read (readInbox) when that tab is the
 * active one: its counts are the summary's, so the candidate scan runs once
 * per render, not once for the panel and again for the line.
 */
export async function getSummary(inbox?: Promise<InboxList>): Promise<Summary> {
  const [counts, accuracy, queue] = await Promise.all([
    (inbox ? inbox.then((l) => l.counts) : readInboxCounts()).catch(orNull('summary inbox')),
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
