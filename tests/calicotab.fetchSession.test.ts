import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FetchSession,
  IngestDeadlineError,
  MIN_REQUEST_MS,
  isIngestDeadlineError,
  resetLearnedIntervals,
} from '@/lib/calicotab/fetchSession';

/**
 * The parts of FetchSession not already covered by
 * calicotab.fetchSessionSlot.test.ts (slot serialisation, adaptive backoff)
 * or fetch.deadline.test.ts (deadline through the fetch layer): the per-host
 * cookie jar that replays Cloudflare clearance cookies, the request-time
 * bookkeeping, the deadline arithmetic itself, and the error type the queue
 * drain keys its "run again with a full budget" decision on.
 */

function responseWithCookies(cookies: string[]): Response {
  const headers = new Headers();
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response('', { headers });
}

beforeEach(() => resetLearnedIntervals());
afterEach(() => vi.useRealTimers());

describe('FetchSession cookie jar', () => {
  it('has no Cookie header for a host it has heard nothing from', () => {
    expect(new FetchSession().getCookieHeader('a.calicotab.com')).toBeUndefined();
  });

  it('keeps name=value from each Set-Cookie and drops the attributes', () => {
    const s = new FetchSession();
    s.storeCookies(
      'a.calicotab.com',
      responseWithCookies([
        'cf_clearance=abc123; Path=/; HttpOnly; Secure',
        'csrftoken=xyz; expires=Wed, 01 Jan 2031 00:00:00 GMT',
      ]),
    );
    expect(s.getCookieHeader('a.calicotab.com')).toBe('cf_clearance=abc123; csrftoken=xyz');
  });

  it('a later Set-Cookie for the same name replaces the value, keeping its position', () => {
    const s = new FetchSession();
    s.storeCookies('h', responseWithCookies(['a=1', 'b=2']));
    s.storeCookies('h', responseWithCookies(['a=3']));
    expect(s.getCookieHeader('h')).toBe('a=3; b=2');
  });

  it('keeps "=" inside a value and trims whitespace around name and value', () => {
    const s = new FetchSession();
    s.storeCookies('h', responseWithCookies([' token = a=b=c ; Path=/']));
    expect(s.getCookieHeader('h')).toBe('token=a=b=c');
  });

  it('ignores cookies with no name (leading "=") or no "=" at all', () => {
    const s = new FetchSession();
    s.storeCookies('h', responseWithCookies(['=orphan', 'novalue', 'ok=1']));
    expect(s.getCookieHeader('h')).toBe('ok=1');
  });

  it('a response with no Set-Cookie creates no jar', () => {
    const s = new FetchSession();
    s.storeCookies('h', new Response(''));
    expect(s.getCookieHeader('h')).toBeUndefined();
  });

  it('jars are per host and per session: nothing leaks to another host or another ingest', () => {
    const a = new FetchSession();
    const b = new FetchSession();
    a.storeCookies('one.calicotab.com', responseWithCookies(['cf_clearance=A']));
    expect(a.getCookieHeader('two.calicotab.com')).toBeUndefined();
    expect(b.getCookieHeader('one.calicotab.com')).toBeUndefined();
  });
});

describe('FetchSession request bookkeeping', () => {
  it('getLastRequestAt is 0 before any request and the mark time after', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-27T00:00:00Z'));
    const s = new FetchSession();
    expect(s.getLastRequestAt('h')).toBe(0);
    s.markRequestNow('h');
    expect(s.getLastRequestAt('h')).toBe(Date.parse('2026-10-27T00:00:00Z'));
    expect(s.getLastRequestAt('other')).toBe(0);
  });

  it('acquireSlot marks the request time itself', async () => {
    const s = new FetchSession();
    const before = Date.now();
    await s.acquireSlot('h', 0);
    expect(s.getLastRequestAt('h')).toBeGreaterThanOrEqual(before);
  });
});

describe('FetchSession deadline arithmetic', () => {
  it('remainingMs counts down to the deadline and goes negative past it', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const s = new FetchSession({ deadline: 10_000 });
    expect(s.deadline).toBe(10_000);
    expect(s.remainingMs()).toBe(10_000);
    vi.setSystemTime(12_000);
    expect(s.remainingMs()).toBe(-2_000);
  });

  it('deadline: null and an omitted deadline both mean no limit', () => {
    expect(new FetchSession({ deadline: null }).deadline).toBeNull();
    expect(new FetchSession().remainingMs()).toBe(Infinity);
  });

  it('assertTimeLeft passes at exactly the needed time and throws one ms short', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const s = new FetchSession({ deadline: 5_000 });
    expect(() => s.assertTimeLeft(5_000)).not.toThrow();
    expect(() => s.assertTimeLeft(5_001)).toThrow(IngestDeadlineError);
  });

  it('the error names what could not be done and clamps a negative remaining time to 0', () => {
    vi.useFakeTimers();
    vi.setSystemTime(9_000);
    const s = new FetchSession({ deadline: 5_000 });
    let caught: unknown;
    try {
      s.assertTimeLeft(MIN_REQUEST_MS, 'write its results');
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(IngestDeadlineError);
    expect((caught as Error).message).toBe(
      `ingest stopped before it could write its results: 0 ms left of this invocation, ${MIN_REQUEST_MS} ms needed`,
    );
  });
});

describe('IngestDeadlineError / isIngestDeadlineError', () => {
  it('has a stable name and default message', () => {
    const e = new IngestDeadlineError();
    expect(e.name).toBe('IngestDeadlineError');
    expect(e.message).toBe('ingest stopped: not enough time left in this invocation');
    expect(e).toBeInstanceOf(Error);
  });

  it('recognises the class and, across module copies, any Error carrying its name', () => {
    expect(isIngestDeadlineError(new IngestDeadlineError('x'))).toBe(true);
    const foreign = new Error('from another bundle');
    foreign.name = 'IngestDeadlineError';
    expect(isIngestDeadlineError(foreign)).toBe(true);
  });

  it('rejects other errors and non-errors', () => {
    expect(isIngestDeadlineError(new Error('IngestDeadlineError'))).toBe(false);
    expect(isIngestDeadlineError({ name: 'IngestDeadlineError' })).toBe(false);
    expect(isIngestDeadlineError('IngestDeadlineError')).toBe(false);
    expect(isIngestDeadlineError(null)).toBe(false);
  });
});
