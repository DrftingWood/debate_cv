import { prisma } from '@/lib/db';
import { getOAuthClientForUser } from '@/lib/gmail/client';
import { extractAllFromGmail } from '@/lib/gmail/run';
import { NoGmailTokenError, type ScanSummary } from '@/lib/gmail/scanUser';
import { enqueueUrl } from '@/lib/queue';
import { writeNotification } from '@/lib/notifications/write';

/**
 * Whole-mailbox scan: the same extractAllFromGmail as the incremental scan,
 * with no `after` bound, so mail that arrives or is forwarded late (older than
 * the newest URL already found) is picked up.
 *
 * Bounds, deliberately different from the incremental scan (cap 500):
 * - up to LIST_CAP message ids are listed (100 per call, 5 quota units each),
 *   so a large mailbox is not cut off at the newest 500;
 * - messages already read in a past scan (DiscoveredUrl.messageId) are not
 *   fetched again, so the expensive part (a 5-unit fetch each) only covers
 *   mail never read; at most FETCH_CAP are fetched, with the same concurrency
 *   of 5 and the same 429/503 backoff as the incremental path;
 * - a deadline stops fetching before the route's 60 s function limit; the
 *   result then reports `truncated` and the rest is picked up by the next
 *   full scan, since the messages read so far are now skipped.
 * Only URLs never seen before are written and queued, so already-ingested (or
 * failed, or dead) URLs are not re-queued, and the bell notification counts
 * only genuinely new URLs.
 */
export const FULL_SCAN_LIST_CAP = 5000;
export const FULL_SCAN_FETCH_CAP = 600;
export const FULL_SCAN_BUDGET_MS = 40_000;

export type FullScanSummary = ScanSummary & { newUrls: number; truncated: boolean };

export async function scanMailboxFull(userId: string): Promise<FullScanSummary> {
  const oauth = await getOAuthClientForUser(userId);
  if (!oauth) throw new NoGmailTokenError();

  const known = await prisma.discoveredUrl.findMany({
    where: { userId },
    select: { url: true, messageId: true },
  });
  const knownUrls = new Set(known.map((k) => k.url));
  const skipMessageIds = new Set(known.flatMap((k) => (k.messageId ? [k.messageId] : [])));

  const summary = await extractAllFromGmail(oauth, {
    max: FULL_SCAN_LIST_CAP,
    maxFetch: FULL_SCAN_FETCH_CAP,
    skipMessageIds,
    deadline: Date.now() + FULL_SCAN_BUDGET_MS,
  });

  await prisma.gmailToken.update({ where: { userId }, data: { lastScannedAt: new Date() } });

  const fresh = summary.urls.filter((r) => !knownUrls.has(r.url));
  for (const r of fresh) {
    await prisma.discoveredUrl.upsert({
      where: { userId_url: { userId, url: r.url } },
      update: {},
      create: {
        userId,
        url: r.url,
        host: r.host,
        tournamentSlug: r.tournamentSlug,
        token: r.token,
        subject: r.subject,
        messageId: r.messageId,
        messageDate: r.messageDate ? new Date(r.messageDate) : null,
      },
    });
    await enqueueUrl(userId, r.url);
  }

  if (fresh.length > 0) {
    await writeNotification({
      userId,
      kind: 'new_urls_found',
      title: `Found ${fresh.length} new ${fresh.length === 1 ? 'URL' : 'URLs'}`,
      body: 'Open Imports to ingest them.',
      href: '/dashboard?filter=pending',
      dedupeWithinMs: 5 * 60 * 1000,
    });
  }

  return {
    scanned: summary.scanned,
    total: summary.total,
    perHost: summary.perHost,
    perTournament: summary.perTournament,
    newUrls: fresh.length,
    truncated: summary.truncated,
  };
}
