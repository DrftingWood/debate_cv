import { prisma } from '@/lib/db';
import { getOAuthClientForUser } from '@/lib/gmail/client';
import { extractAllFromGmail } from '@/lib/gmail/run';
import { enqueueUrl } from '@/lib/queue';
import { writeNotification } from '@/lib/notifications/write';

export type ScanSummary = {
  scanned: number;
  total: number;
  perHost: Record<string, number>;
  perTournament: Record<string, number>;
};

/** Thrown when the user has no usable Gmail grant stored. */
export class NoGmailTokenError extends Error {
  constructor() {
    super('no_gmail_token');
    this.name = 'NoGmailTokenError';
  }
}

/**
 * Scan one user's mailbox for Tabbycat private URLs, record what it finds and
 * queue each URL for ingest. Shared by the Scan Gmail button
 * (app/api/ingest/gmail) and the background scan the cron tick runs
 * (lib/gmail/backgroundScan.ts), so both do exactly the same thing.
 *
 * Incremental: only mail newer than the latest URL already found, minus one
 * day for timezone skew. The first ever scan has no upper bound on age.
 * Throws on any Gmail or database failure; the callers decide what to do with
 * a revoked token (see isRefreshTokenInvalid in the route).
 */
export async function scanMailbox(userId: string): Promise<ScanSummary> {
  const oauth = await getOAuthClientForUser(userId);
  if (!oauth) throw new NoGmailTokenError();

  const lastUrl = await prisma.discoveredUrl.findFirst({
    where: { userId },
    orderBy: { messageDate: 'desc' },
    select: { messageDate: true },
  });
  const afterDate = lastUrl?.messageDate
    ? new Date(lastUrl.messageDate.getTime() - 86_400_000)
    : undefined;

  const summary = await extractAllFromGmail(oauth, { after: afterDate });

  await prisma.gmailToken.update({
    where: { userId },
    data: { lastScannedAt: new Date() },
  });

  for (const r of summary.urls) {
    await prisma.discoveredUrl.upsert({
      where: { userId_url: { userId, url: r.url } },
      update: {
        subject: r.subject,
        messageId: r.messageId,
        messageDate: r.messageDate ? new Date(r.messageDate) : null,
      },
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

  if (summary.total > 0) {
    // Best-effort bell notification on new URLs. Deduped within five minutes so
    // two scans over the same window do not post two entries.
    await writeNotification({
      userId,
      kind: 'new_urls_found',
      title: `Found ${summary.total} new ${summary.total === 1 ? 'URL' : 'URLs'}`,
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
  };
}
