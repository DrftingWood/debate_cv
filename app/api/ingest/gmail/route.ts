import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { auth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { prisma } from '@/lib/db';
import { grantGoneResponse } from '@/lib/gmail/grantGone';
import { NoGmailTokenError, scanMailbox } from '@/lib/gmail/scanUser';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Wait between manual scans. Gmail scans are heavy (a search plus a fetch per
 * message), the results do not change minute to minute, and a user mashing the
 * button serves no purpose. Short, because a background scan (the cron tick,
 * lib/gmail/backgroundScan.ts) and the CV page's scan on open also count: they
 * all stamp the same lastScannedAt.
 */
const SCAN_COOLDOWN_MS = 2 * 60 * 1000;

export async function POST() {
  let userId: string | null = null;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const limited = await enforceRateLimit('ingest:gmail', session.user.id);
    if (limited) return limited;
    userId = session.user.id;

    // Per-user cooldown. Returns 429 with a Retry-After header.
    const token = await prisma.gmailToken.findUnique({
      where: { userId },
      select: { lastScannedAt: true },
    });
    if (token?.lastScannedAt) {
      const elapsed = Date.now() - token.lastScannedAt.getTime();
      if (elapsed < SCAN_COOLDOWN_MS) {
        const retryAfter = Math.ceil((SCAN_COOLDOWN_MS - elapsed) / 1000);
        return NextResponse.json(
          {
            error: 'rate_limited',
            hint: `Please wait ${retryAfter}s before scanning again.`,
            retryAfter,
          },
          { status: 429, headers: { 'Retry-After': String(retryAfter) } },
        );
      }
    }

    const summary = await scanMailbox(userId);

    return NextResponse.json({
      scanned: summary.scanned,
      found: summary.total,
      perHost: summary.perHost,
      perTournament: summary.perTournament,
    });
  } catch (err) {
    if (err instanceof NoGmailTokenError) {
      return NextResponse.json(
        { error: 'no_gmail_token', hint: 'Re-sign in with Google to grant Gmail access.' },
        { status: 400 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/ingest/gmail]', msg);
    const gone = await grantGoneResponse(err, userId);
    if (gone) return gone;
    // A genuine unexpected error: report with the userId so it can be correlated.
    Sentry.captureException(err, {
      tags: { route: 'api/ingest/gmail' },
      user: userId ? { id: userId } : undefined,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
