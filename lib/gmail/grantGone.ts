import { NextResponse } from 'next/server';
import { revokeAndForgetGmailToken } from '@/lib/gmail/client';
import { isGmailScopeMissing, isRefreshTokenInvalid } from '@/lib/gmail/errors';

/**
 * The scan routes' answer when the Gmail grant itself is the problem, or null
 * when it is not. Both cases are expected user states, not server errors, so
 * neither is reported to Sentry, and the stored token, which can never scan
 * again, is forgotten: the dashboard then offers Reconnect Gmail and the
 * background scan stops trying it.
 *
 * - Gmail left unticked on Google's consent screen: the token works but has
 *   no gmail.readonly (403 gmail_scope_missing).
 * - Access revoked in Google, or the refresh token expired (401 token_invalid).
 */
export async function grantGoneResponse(
  err: unknown,
  userId: string | null,
): Promise<NextResponse | null> {
  const scopeMissing = isGmailScopeMissing(err);
  if (!scopeMissing && !isRefreshTokenInvalid(err)) return null;
  if (userId) {
    try {
      await revokeAndForgetGmailToken(userId);
    } catch {
      /* intentional: the local row is the goal, and the token may be dead upstream */
    }
  }
  return scopeMissing
    ? NextResponse.json(
        {
          error: 'gmail_scope_missing',
          hint: 'Google did not give us access to your Gmail. Reconnect Gmail and tick the box that lets us read your email.',
        },
        { status: 403 },
      )
    : NextResponse.json(
        {
          error: 'token_invalid',
          hint: 'Your Google access was revoked or expired. Sign out and sign back in to grant Gmail access again.',
        },
        { status: 401 },
      );
}
