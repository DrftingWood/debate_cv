import { describe, expect, it } from 'vitest';
import {
  cooldownSeconds,
  cooldownSpoken,
  formatCountdown,
  scanErrorMessage,
  secondsLeft,
} from '@/lib/ingest/scanErrorMessage';

describe('scanErrorMessage', () => {
  it('treats the 2-minute cooldown as a neutral wait, never a failure', () => {
    const notice = scanErrorMessage({ status: 429, error: 'rate_limited', retryAfterSec: 102 });
    expect(notice.kind).toBe('cooldown');
    expect(notice.title).toBe('Scanned a moment ago');
    expect(notice.title).not.toMatch(/fail/i);
    expect(notice.description).toMatch(/2 minutes/);
    expect(notice.description).not.toMatch(/rate_limited/);
    expect(notice.kind === 'cooldown' && notice.retryAfterSec).toBe(102);
  });

  it('recognises the cooldown by status or by code alone', () => {
    expect(scanErrorMessage({ status: 429, error: 'anything' }).kind).toBe('cooldown');
    expect(scanErrorMessage({ status: 200, error: 'rate_limited' }).kind).toBe('cooldown');
  });

  it('names the hourly cap when the wait is longer than the cooldown', () => {
    const notice = scanErrorMessage({ status: 429, error: 'rate_limited', retryAfterSec: 1800 });
    expect(notice.kind).toBe('cooldown');
    expect(notice.title).toBe('Scan limit reached');
    expect(notice.description).toMatch(/twelve an hour/);
  });

  it('maps real failures to plain words, never the bare code', () => {
    const expired = scanErrorMessage({ status: 401, error: 'unauthorized' });
    expect(expired.kind).toBe('error');
    expect(expired.title).toBe('Scan did not finish');
    expect(expired.description).toMatch(/session has expired/);

    const revoked = scanErrorMessage({ status: 401, error: 'token_invalid' });
    expect(revoked.description).toMatch(/Reconnect Gmail/);

    const crash = scanErrorMessage({ status: 500, error: 'HTTP 500' });
    expect(crash.description).not.toContain('HTTP 500');
    expect(crash.description).toMatch(/error 500/);
  });
});

describe('scan cooldown countdown', () => {
  it('counts whole seconds down to zero and never below', () => {
    const start = 1_000_000;
    const until = start + 102_000;
    expect(secondsLeft(until, start)).toBe(102);
    expect(secondsLeft(until, start + 500)).toBe(102); // a partial second still shows
    expect(secondsLeft(until, start + 1_000)).toBe(101);
    expect(secondsLeft(until, start + 101_001)).toBe(1);
    expect(secondsLeft(until, until)).toBe(0);
    expect(secondsLeft(until, until + 60_000)).toBe(0);
  });

  it('re-reads the clock, so a throttled background tab is right on return', () => {
    const start = 0;
    const until = start + 120_000;
    // No ticks for 90 s (tab hidden): the next read is still exact.
    expect(secondsLeft(until, start + 90_000)).toBe(30);
  });

  it('formats the button clock as m:ss, and h:mm:ss past an hour', () => {
    expect(formatCountdown(102)).toBe('1:42');
    expect(formatCountdown(60)).toBe('1:00');
    expect(formatCountdown(9)).toBe('0:09');
    expect(formatCountdown(0)).toBe('0:00');
    expect(formatCountdown(-5)).toBe('0:00');
    expect(formatCountdown(3723)).toBe('1:02:03');
  });

  it('speaks the wait in words for the status region', () => {
    expect(cooldownSpoken(102)).toBe('You can scan again in 1 minute 42 seconds.');
    expect(cooldownSpoken(120)).toBe('You can scan again in 2 minutes.');
    expect(cooldownSpoken(1)).toBe('You can scan again in 1 second.');
  });

  it('locks for the documented 2 minutes when the server gives no wait', () => {
    const noWait = scanErrorMessage({ status: 429, error: 'rate_limited' });
    const withWait = scanErrorMessage({ status: 429, error: 'rate_limited', retryAfterSec: 37 });
    if (noWait.kind !== 'cooldown' || withWait.kind !== 'cooldown')
      throw new Error('expected cooldown');
    expect(cooldownSeconds(noWait)).toBe(120);
    expect(cooldownSeconds(withWait)).toBe(37);
  });
});
