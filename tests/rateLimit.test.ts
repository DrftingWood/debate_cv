import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));

import { prismaMock, resetPrismaMock } from './setup/api-test-utils';
import {
  RATE_LIMITS,
  consumeRateLimit,
  enforceRateLimit,
  formatWait,
  pruneRateLimits,
} from '@/lib/rateLimit';

/**
 * lib/rateLimit.ts is a fixed-window counter over one atomic upsert. The SQL
 * itself needs Postgres; what is pinned here is everything around it: the
 * bucket key, the arithmetic on the returned row, the fail-open policy, the
 * 429 response shape and the retention cutoff. The routes that opt in mock
 * enforceRateLimit away, so none of this was exercised before.
 */

const NOW = new Date('2026-10-27T12:00:00Z');

beforeEach(() => {
  resetPrismaMock();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** The counter row the upsert RETURNs: `count` requests in a window opened `ageSec` ago. */
function counterRow(count: number, ageSec: number) {
  return [{ count, windowStart: new Date(NOW.getTime() - ageSec * 1000) }];
}

/** Flatten the tagged-template call so the key and interval values can be read. */
function rawCallValues(): unknown[] {
  const call = prismaMock.$queryRaw.mock.calls[0];
  expect(call).toBeDefined();
  return call!.slice(1);
}

describe('RATE_LIMITS policy table', () => {
  it('every rule has a positive limit and window', () => {
    for (const [name, rule] of Object.entries(RATE_LIMITS)) {
      expect(rule.limit, name).toBeGreaterThan(0);
      expect(rule.windowSec, name).toBeGreaterThan(0);
    }
  });

  it('pins the ingest limits (the routes that trigger outbound scrapes)', () => {
    expect(RATE_LIMITS['ingest:url']).toEqual({ limit: 20, windowSec: 3600 });
    // C85: pasted URLs also have a daily cap, equal to the CSV day's 5 x 20.
    expect(RATE_LIMITS['ingest:url:daily']).toEqual({ limit: 100, windowSec: 86400 });
    expect(RATE_LIMITS['ingest:gmail']).toEqual({ limit: 12, windowSec: 3600 });
    expect(RATE_LIMITS['ingest:csv']).toEqual({ limit: 5, windowSec: 86400 });
  });
});

describe('consumeRateLimit', () => {
  it('keys the bucket as "<name>:<subject>" and passes the window as an interval string', async () => {
    prismaMock.$queryRaw.mockResolvedValue(counterRow(1, 0));
    await consumeRateLimit('ingest:url', 'user-1');
    const values = rawCallValues();
    expect(values[0]).toBe('ingest:url:user-1');
    // Both CASE branches compare against the same window.
    expect(values.filter((v) => v === '3600 seconds')).toHaveLength(2);
  });

  it('first request of a window: ok, remaining = limit - 1, retry after the full window', async () => {
    prismaMock.$queryRaw.mockResolvedValue(counterRow(1, 0));
    const r = await consumeRateLimit('ingest:url', 'user-1');
    expect(r).toEqual({ ok: true, retryAfterSec: 3600, limit: 20, remaining: 19 });
  });

  it('the request that reaches the limit exactly is still allowed, with 0 remaining', async () => {
    prismaMock.$queryRaw.mockResolvedValue(counterRow(20, 600));
    const r = await consumeRateLimit('ingest:url', 'user-1');
    expect(r).toEqual({ ok: true, retryAfterSec: 3000, limit: 20, remaining: 0 });
  });

  it('one over the limit is refused; remaining never goes negative', async () => {
    prismaMock.$queryRaw.mockResolvedValue(counterRow(25, 600));
    const r = await consumeRateLimit('ingest:url', 'user-1');
    expect(r.ok).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.retryAfterSec).toBe(3000);
  });

  it('retryAfterSec is floored at 1 second, even for a window that has already elapsed', async () => {
    prismaMock.$queryRaw.mockResolvedValue(counterRow(30, 3600 + 50));
    const r = await consumeRateLimit('ingest:url', 'user-1');
    expect(r.retryAfterSec).toBe(1);
  });

  it('accepts windowStart as a string (raw rows are not always Date objects)', async () => {
    prismaMock.$queryRaw.mockResolvedValue([
      { count: 2, windowStart: new Date(NOW.getTime() - 10_000).toISOString() },
    ]);
    const r = await consumeRateLimit('cv:export', 'user-1');
    expect(r).toEqual({ ok: true, retryAfterSec: 3590, limit: 30, remaining: 28 });
  });

  it('an empty RETURNING (should not happen) is treated as allowed with the full budget', async () => {
    prismaMock.$queryRaw.mockResolvedValue([]);
    const r = await consumeRateLimit('ingest:csv', 'user-1');
    expect(r).toEqual({ ok: true, retryAfterSec: 0, limit: 5, remaining: 5 });
  });

  it('fails OPEN when the counter query throws, and logs the failure', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    prismaMock.$queryRaw.mockRejectedValue(new Error('relation "RateLimit" does not exist'));
    const r = await consumeRateLimit('ingest:url', 'user-1');
    expect(r).toEqual({ ok: true, retryAfterSec: 0, limit: 20, remaining: 20 });
    expect(err).toHaveBeenCalledWith(
      '[rateLimit] counter unavailable, allowing request',
      expect.objectContaining({
        name: 'ingest:url',
        message: 'relation "RateLimit" does not exist',
      }),
    );
  });
});

describe('enforceRateLimit', () => {
  it('returns null while under budget', async () => {
    prismaMock.$queryRaw.mockResolvedValue(counterRow(3, 10));
    expect(await enforceRateLimit('ingest:url', 'user-1')).toBeNull();
  });

  it('returns null when the counter is unavailable (fail open)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    prismaMock.$queryRaw.mockRejectedValue(new Error('db down'));
    expect(await enforceRateLimit('ingest:url', 'user-1')).toBeNull();
  });

  it('returns a 429 with Retry-After and RateLimit-* headers when over budget', async () => {
    prismaMock.$queryRaw.mockResolvedValue(counterRow(21, 600));
    const res = await enforceRateLimit('ingest:url', 'user-1');
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get('Retry-After')).toBe('3000');
    expect(res!.headers.get('RateLimit-Limit')).toBe('20');
    expect(res!.headers.get('RateLimit-Remaining')).toBe('0');
    expect(res!.headers.get('RateLimit-Reset')).toBe('3000');
    const body = await res!.json();
    // 3000 s is 50 minutes. Was "50 minute(s)" before formatWait: the message
    // now pluralises properly and picks the unit (see the formatWait suite).
    expect(body).toEqual({
      error: 'rate_limited',
      reason: 'Too many requests. Try again in 50 minutes.',
    });
  });

  it('states sub-minute waits in seconds', async () => {
    // Previously pinned as "1 minute(s)": every wait was rounded up to whole
    // minutes. A 10 s wait now says 10 seconds; Retry-After is unchanged.
    prismaMock.$queryRaw.mockResolvedValue(counterRow(99, 3590));
    const res = await enforceRateLimit('ingest:url', 'user-1');
    expect(res!.headers.get('Retry-After')).toBe('10');
    const body = await res!.json();
    expect(body.reason).toBe('Too many requests. Try again in 10 seconds.');
  });

  it('regression: the daily CSV limit no longer reads "1440 minute(s)"', async () => {
    prismaMock.$queryRaw.mockResolvedValue(counterRow(6, 0));
    const res = await enforceRateLimit('ingest:csv', 'user-1');
    // The header stays in seconds; only the human message changed.
    expect(res!.headers.get('Retry-After')).toBe('86400');
    expect(res!.headers.get('RateLimit-Reset')).toBe('86400');
    const body = await res!.json();
    expect(body.reason).toBe('Too many requests. Try again in 1 day.');
  });
});

describe('formatWait', () => {
  it.each([
    [0, '1 second'],
    [1, '1 second'],
    [10, '10 seconds'],
    [59, '59 seconds'],
    [60, '1 minute'],
    [61, '2 minutes'],
    [3000, '50 minutes'],
    [3599, '1 hour'],
    [3600, '1 hour'],
    [3601, '1 hour 1 minute'],
    [5400, '1 hour 30 minutes'],
    [7200, '2 hours'],
    [86000, '23 hours 54 minutes'],
    [86400, '1 day'],
    [86401, '1 day 1 hour'],
    [90000, '1 day 1 hour'],
    [2 * 86400 - 60, '2 days'],
    [3 * 86400, '3 days'],
  ])('%i s -> %s', (sec, text) => {
    expect(formatWait(sec)).toBe(text);
  });

  it('never understates the wait (rounds up at the smallest unit shown)', () => {
    for (let s = 1; s <= 3 * 86400; s += 211) {
      const text = formatWait(s);
      const parts = [...text.matchAll(/(\d+) (second|minute|hour|day)/g)];
      const mult = { second: 1, minute: 60, hour: 3600, day: 86400 } as const;
      const total = parts.reduce(
        (acc, [, n, u]) => acc + Number(n) * mult[u as keyof typeof mult],
        0,
      );
      expect(total, `${s} -> ${text}`).toBeGreaterThanOrEqual(s);
    }
  });
});

describe('pruneRateLimits', () => {
  it('deletes counters whose window opened more than 7 days ago and returns the count', async () => {
    prismaMock.rateLimit.deleteMany.mockResolvedValue({ count: 4 });
    const n = await pruneRateLimits();
    expect(n).toBe(4);
    expect(prismaMock.rateLimit.deleteMany).toHaveBeenCalledWith({
      where: { windowStart: { lt: new Date(NOW.getTime() - 7 * 24 * 3600 * 1000) } },
    });
  });
});
