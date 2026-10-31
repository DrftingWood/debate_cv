import { cache } from 'react';
import { prisma } from '@/lib/db';
import { getAccuracyOverview } from '@/lib/admin/accuracy';
import { listInbox } from '@/lib/admin/inbox';
import { orNull } from '@/lib/admin/orNull';

/**
 * The inbox page, read once per request. The summary line (above every tab)
 * and the Inbox panel both need it, and a read is a scan of every source.
 */
export const readInbox = cache((page: number) => listInbox({ page }));

/**
 * The figures of the line above the tabs. Each is null when its read failed:
 * the line then shows a dash for that figure and still renders, as every
 * other /admin section does.
 */
export type Summary = {
  /** Open inbox items. */
  needsYou: number | null;
  accuracy: { score: number | null; good: number; check: number; rescrape: number } | null;
  /** Failed imports whose tournament is not stored. */
  importsFailing: number | null;
  /** Jobs waiting to be ingested. */
  queue: number | null;
};

export async function getSummary(): Promise<Summary> {
  const [inbox, accuracy, queue] = await Promise.all([
    readInbox(1).catch(orNull('summary inbox')),
    getAccuracyOverview().catch(orNull('summary accuracy')),
    prisma.ingestJob.count({ where: { status: 'pending' } }).catch(orNull('summary queue')),
  ]);
  return {
    needsYou: inbox ? Object.values(inbox.counts).reduce((a, b) => a + b, 0) : null,
    accuracy: accuracy ? { score: accuracy.weighted, ...accuracy.bands } : null,
    importsFailing: inbox ? inbox.counts.import : null,
    queue,
  };
}
