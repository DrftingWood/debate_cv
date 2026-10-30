import { describe, expect, it } from 'vitest';
import { isGmailScopeMissing, isRefreshTokenInvalid } from '@/lib/gmail/errors';

/**
 * What googleapis throws when the token works but was granted without
 * gmail.readonly: Google's consent screen lists Gmail as its own checkbox,
 * and a user who leaves it unticked signs in with name and email only.
 * Seen on production 2026-10-30 as "[api/ingest/gmail] Insufficient Permission".
 */
function scopeError(): Error {
  return Object.assign(new Error('Insufficient Permission'), {
    status: 403,
    response: {
      status: 403,
      data: {
        error: {
          code: 403,
          message: 'Request had insufficient authentication scopes.',
          errors: [{ reason: 'insufficientPermissions', message: 'Insufficient Permission' }],
          status: 'PERMISSION_DENIED',
          details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }],
        },
      },
    },
  });
}

describe('isGmailScopeMissing', () => {
  it('recognises a token granted without Gmail access', () => {
    expect(isGmailScopeMissing(scopeError())).toBe(true);
  });

  it('recognises the bare message when the response is missing', () => {
    expect(isGmailScopeMissing(new Error('Insufficient Permission'))).toBe(true);
  });

  it('is not a revoked token, and a revoked token is not it', () => {
    expect(isRefreshTokenInvalid(scopeError())).toBe(false);
    expect(isGmailScopeMissing(new Error('invalid_grant'))).toBe(false);
  });

  it('leaves other 403s alone (a rate limit is a 403 too)', () => {
    const rateLimited = Object.assign(new Error('User Rate Limit Exceeded'), {
      status: 403,
      response: {
        status: 403,
        data: { error: { code: 403, errors: [{ reason: 'userRateLimitExceeded' }] } },
      },
    });
    expect(isGmailScopeMissing(rateLimited)).toBe(false);
    expect(isGmailScopeMissing(null)).toBe(false);
    expect(isGmailScopeMissing('Insufficient Permission')).toBe(false);
  });
});
