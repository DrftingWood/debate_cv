import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getOAuthClientForUser, revokeAndForgetGmailToken } from '@/lib/gmail/client';
import { extractAllFromGmail } from '@/lib/gmail/run';
import { enqueueUrl } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Returns true if the error came from Google rejecting our refresh token.
 * Common triggers: user revoked our access in their Google Account
 * permissions, granted scopes were narrowed, refresh token expired (rare).
 * In all these cases we want to clear the stored token + tell the user to
 * sign in again, rather than surface a generic 500.
 */
function isRefreshTokenInvalid(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = 'message' in err && typeof err.message === 'string' ? err.message : '';
  if (/invalid_grant|invalid_token|token (?:expired|revoked|not granted)/i.test(message)) {
    return true;
  }
  // googleapis throws GaxiosError; the OAuth error is in response.data.error.
  const response = (err as { response?: { data?: { error?: string } } }).response;
  if (response?.data?.error && /invalid_grant|invalid_token/i.test(response.data.error)) {
    return true;
  }
  return false;
}

export async function POST() {
  let userId: string | null = null;
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    userId = session.user.id;

    const oauth = await getOAuthClientForUser(userId);
    if (!oauth) {
      return NextResponse.json(
        { error: 'no_gmail_token', hint: 'Re-sign in with Google to grant Gmail access.' },
        { status: 400 },
      );
    }

    const summary = await extractAllFromGmail(oauth);

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

    return NextResponse.json({
      scanned: summary.scanned,
      found: summary.total,
      perHost: summary.perHost,
      perTournament: summary.perTournament,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/ingest/gmail]', msg);
    if (isRefreshTokenInvalid(err)) {
      // Don't report token-invalid to Sentry — it's expected user action
      // (they revoked our access via Google) and we already give the user
      // a clear re-OAuth path below. Reporting would just noise up Sentry
      // every time someone disconnects.
      // Clear the stale token so the next sign-in writes a fresh one.
      // Swallow errors from the revoke call — the goal is the local row, not
      // notifying Google (whose endpoint may already have invalidated it).
      if (userId) {
        try { await revokeAndForgetGmailToken(userId); } catch {
          /* intentional: token already invalid upstream */
        }
      }
      return NextResponse.json(
        {
          error: 'token_invalid',
          hint: 'Your Google access was revoked or expired. Sign out and sign back in to grant Gmail access again.',
        },
        { status: 401 },
      );
    }
    // Genuine unexpected error — report to Sentry with the userId attached
    // so we can correlate. The catch block returns 500 to the client, so
    // the error wouldn't otherwise propagate to Sentry's auto-capture.
    Sentry.captureException(err, { tags: { route: 'api/ingest/gmail' }, user: userId ? { id: userId } : undefined });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
