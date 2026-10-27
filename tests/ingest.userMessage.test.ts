import { describe, expect, it } from 'vitest';
import {
  failureToast,
  ingestErrorCategory,
  messageFromThrown,
  spokenDuration,
  thrownToast,
  userMessage,
} from '@/lib/ingest/userMessage';
import { failureFrom, parseRetryAfter } from '@/lib/utils/api';

const RAW_CODE = /\b[a-z]+_[a-z_]+\b|HTTP \d{3}/;

describe('userMessage', () => {
  it.each([
    [401, 'unauthorized', /session has expired/],
    [400, 'no_gmail_token', /Gmail is not connected/],
    [401, 'token_invalid', /Reconnect Gmail/],
    [400, 'bad_request', /Reload the page/],
    [400, 'not_a_private_url', /not a Tabbycat private URL/],
    [404, 'not_found', /no longer exists/],
    [403, 'forbidden', /tournaments you have imported/],
    [409, 'already_claimed_by_other', /Another account claimed/],
  ])('maps %i %s to a sentence with a next step', (status, error, expected) => {
    const m = userMessage({ status, error });
    expect(m.kind).toBe('error');
    expect(m.description).toMatch(expected);
    expect(m.description).not.toMatch(RAW_CODE);
  });

  it('treats waits that end well on their own as info, with a neutral heading', () => {
    for (const [status, error, title] of [
      [429, 'rate_limited', 'Please wait'],
      [503, 'deferred', 'Queued instead'],
      [503, 'transient_deadlock', 'Rescheduled'],
    ] as const) {
      const m = userMessage({ status, error });
      expect(m.kind).toBe('info');
      expect(m.title).toBe(title);
      expect(m.description).not.toMatch(RAW_CODE);
    }
  });

  it('says how long to wait when the server said so', () => {
    expect(
      userMessage({ status: 429, error: 'rate_limited', retryAfterSec: 42 }).description,
    ).toMatch(/Try again in 42 seconds/);
    expect(userMessage({ status: 429, error: 'rate_limited' }).description).toMatch(
      /Wait a minute/,
    );
  });

  it('describes a network failure without the browser message', () => {
    const m = userMessage({ status: 0, error: 'Failed to fetch' });
    expect(m.description).toMatch(/Could not reach the server/);
    expect(m.description).not.toContain('Failed to fetch');
  });
});

describe('userMessage fallbacks', () => {
  it("prefers the route's own sentence for identity checks", () => {
    const hint = '"Sam Lee" does not match the name on your private URL or your account.';
    expect(userMessage({ status: 403, error: 'identity_mismatch', hint }).description).toBe(hint);
  });

  it('never shows an unknown code: hint first, then a sentence by status', () => {
    expect(
      userMessage({ status: 400, error: 'weird_code', hint: 'Do the thing.' }).description,
    ).toBe('Do the thing.');
    for (const [status, error] of [
      [500, 'HTTP 500'],
      [500, "Cannot read properties of undefined (reading 'map')"],
      [502, 'HTTP 502'],
      [504, 'HTTP 504'],
      [418, 'weird_code'],
    ] as const) {
      const m = userMessage({ status, error });
      expect(m.kind).toBe('error');
      expect(m.description).not.toContain(error);
    }
    expect(userMessage({ status: 504, error: 'HTTP 504' }).description).toMatch(/took too long/);
    expect(userMessage({ status: 503, error: 'HTTP 503' }).description).toMatch(/error 503/);
  });

  it('does not resolve codes through the object prototype', () => {
    const m = userMessage({ status: 500, error: 'constructor' });
    expect(typeof m.description).toBe('string');
    expect(m.description).toMatch(/error 500/);
  });
});

describe('failureToast / thrownToast', () => {
  it("keeps the caller's failure heading for errors only", () => {
    expect(failureToast({ status: 500, error: 'HTTP 500' }, 'Clear failed')).toMatchObject({
      kind: 'error',
      title: 'Clear failed',
    });
    expect(failureToast({ status: 429, error: 'rate_limited' }, 'Clear failed')).toMatchObject({
      kind: 'info',
      title: 'Please wait',
    });
  });

  it('maps the bare codes drainUntilEmpty throws', () => {
    expect(messageFromThrown(new Error('HTTP 500')).description).toMatch(/error 500/);
    expect(messageFromThrown(new Error('unauthorized')).description).toMatch(/session has expired/);
    expect(messageFromThrown(new TypeError('Failed to fetch')).description).toMatch(
      /Could not reach/,
    );
    expect(messageFromThrown('not an error').description).toMatch(/Something went wrong/);
    expect(thrownToast(new Error('rate_limited'), 'Import did not finish')).toMatchObject({
      kind: 'info',
      title: 'Please wait',
    });
  });
});

describe('ingestErrorCategory', () => {
  it.each([
    ['fetch landing https://x.calicotab.com/t/privateurls/abc/ → HTTP 404', /no longer exists/],
    ['fetch timeout after 15000ms: https://x.calicotab.com/t/', /did not respond in time/],
    ['fetch public home https://x.calicotab.com/t/ → HTTP 503', /problem on its side/],
    [
      'Exceeded 3 attempts without completing — the ingest does not fit in the function time budget.',
      /too large/,
    ],
    [
      'Does not fit in the function time budget even when started first: ingest stopped: deadline reached',
      /too large/,
    ],
    ['refusing redirect off the allowlist: a → b', /address we do not follow/],
    ['deadlock detected (40P01)', /collided/],
    ["Cannot read properties of undefined (reading 'map')", /could not read this tab page/],
    ['something nobody has seen before', /did not finish/],
  ])('%s', (raw, expected) => {
    const category = ingestErrorCategory(raw);
    expect(category).toMatch(expected);
    expect(category).not.toContain('http');
  });
});

describe('spokenDuration', () => {
  it('reads like speech', () => {
    expect(spokenDuration(0)).toBe('0 seconds');
    expect(spokenDuration(61)).toBe('1 minute 1 second');
    expect(spokenDuration(3725)).toBe('1 hour 2 minutes');
  });
});

describe('postJson failure parsing', () => {
  const now = Date.parse('2026-10-27T12:00:00Z');

  it('carries retryAfter from the body', () => {
    expect(failureFrom(429, { error: 'rate_limited', retryAfter: 102 }, null)).toEqual({
      ok: false,
      status: 429,
      error: 'rate_limited',
      retryAfterSec: 102,
    });
  });

  it('falls back to the Retry-After header, in seconds or as a date', () => {
    expect(failureFrom(429, { error: 'rate_limited' }, '37').retryAfterSec).toBe(37);
    expect(parseRetryAfter('Tue, 27 Oct 2026 12:01:30 GMT', now)).toBe(90);
    expect(parseRetryAfter('garbage', now)).toBeUndefined();
    expect(parseRetryAfter('0', now)).toBeUndefined();
    expect(parseRetryAfter('Tue, 27 Oct 2026 11:00:00 GMT', now)).toBeUndefined();
  });

  it("carries the route's hint or reason sentence", () => {
    expect(failureFrom(400, { error: 'no_gmail_token', hint: 'Re-sign in.' }, null).hint).toBe(
      'Re-sign in.',
    );
    expect(failureFrom(403, { error: 'identity_mismatch', reason: 'Not you.' }, null).hint).toBe(
      'Not you.',
    );
  });

  it('never returns an HTML error page as the error', () => {
    const f = failureFrom(504, null, null);
    expect(f.error).toBe('HTTP 504');
    expect(f).not.toHaveProperty('hint');
    expect(f).not.toHaveProperty('retryAfterSec');
  });
});

describe('codes from settings, sharing and onboarding routes', () => {
  it('turns the account and onboarding codes into sentences', () => {
    for (const error of ['email_mismatch', 'unauthorized', 'not_found']) {
      const m = userMessage({ status: 400, error });
      expect(m.description).not.toMatch(RAW_CODE);
    }
    expect(userMessage({ status: 500, error: 'Prisma exploded: P2002' }).description).not.toContain(
      'P2002',
    );
  });
});
