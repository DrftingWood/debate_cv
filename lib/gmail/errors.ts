/**
 * Did this error come from Google rejecting our refresh token?
 *
 * Common triggers: the user revoked our access in their Google Account
 * permissions, the granted scopes were narrowed, or the refresh token expired
 * (rare). In all of them the stored token is dead and the right response is to
 * clear it and let the user grant access again, not to report a server error.
 */
export function isRefreshTokenInvalid(err: unknown): boolean {
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

/**
 * Did Gmail refuse because our token was granted without gmail.readonly?
 *
 * Google's consent screen lists Gmail access as its own checkbox, so a user
 * can sign in with name and email only. The token then works, but every
 * Gmail call fails with 403 "Insufficient Permission". It is not a server
 * error either: the user has to sign in again and tick the box. Checked by
 * reason, not by status alone, because Gmail's rate limits are 403s as well.
 */
export function isGmailScopeMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = 'message' in err && typeof err.message === 'string' ? err.message : '';
  if (/insufficient permission|insufficient authentication scopes/i.test(message)) return true;
  const error = (
    err as {
      response?: {
        data?: { error?: { errors?: { reason?: string }[]; details?: { reason?: string }[] } };
      };
    }
  ).response?.data?.error;
  if (!error || typeof error !== 'object') return false;
  const reasons = [...(error.errors ?? []), ...(error.details ?? [])].map((e) => e.reason);
  return reasons.some(
    (r) => r === 'insufficientPermissions' || r === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
  );
}
