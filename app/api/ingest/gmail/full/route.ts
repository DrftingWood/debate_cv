import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { auth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { prisma } from '@/lib/db';
import { grantGoneResponse } from '@/lib/gmail/grantGone';
import { NoGmailTokenError } from '@/lib/gmail/scanUser';
import { scanMailboxFull } from '@/lib/gmail/scanFull';
import { claimFullScan, fullScanBlockedReason, releaseFullScan } from '@/lib/gmail/fullScan';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * POST /api/ingest/gmail/full: re-read the whole mailbox (no `after` bound).
 * At most one per user per rolling 24 hours, enforced here via claimFullScan
 * (lib/gmail/fullScan.ts). A second attempt gets 429 with `availableAt`.
 * The incremental scan (../route.ts) stays the default and is unchanged.
 */
export async function POST() {
  let userId: string | null = null;
  let claimed = false;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    userId = session.user.id;
    const limited = await enforceRateLimit('ingest:gmail', userId);
    if (limited) return limited;

    const token = await prisma.gmailToken.findUnique({
      where: { userId },
      select: { userId: true },
    });
    if (!token) {
      return NextResponse.json(
        { error: 'no_gmail_token', hint: 'Re-sign in with Google to grant Gmail access.' },
        { status: 400 },
      );
    }

    const gate = await claimFullScan(userId);
    if (!gate.allowed) {
      const reason = fullScanBlockedReason(gate.retryAfterSec);
      return NextResponse.json(
        {
          error: 'rate_limited',
          reason,
          hint: reason,
          retryAfter: gate.retryAfterSec,
          availableAt: gate.availableAt.toISOString(),
        },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfterSec) } },
      );
    }
    claimed = true;

    const summary = await scanMailboxFull(userId);
    return NextResponse.json({
      scanned: summary.scanned,
      found: summary.newUrls,
      truncated: summary.truncated,
      perHost: summary.perHost,
      perTournament: summary.perTournament,
    });
  } catch (err) {
    // A scan that failed does not use up the day's one scan.
    if (userId && claimed) {
      try {
        await releaseFullScan(userId);
      } catch {
        /* best effort */
      }
    }
    if (err instanceof NoGmailTokenError) {
      return NextResponse.json(
        { error: 'no_gmail_token', hint: 'Re-sign in with Google to grant Gmail access.' },
        { status: 400 },
      );
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/ingest/gmail/full]', msg);
    const gone = await grantGoneResponse(err, userId);
    if (gone) return gone;
    Sentry.captureException(err, {
      tags: { route: 'api/ingest/gmail/full' },
      user: userId ? { id: userId } : undefined,
    });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
