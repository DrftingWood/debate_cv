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
