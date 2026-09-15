import { describe, expect, test } from 'vitest';
import { isCdnRateLimit, isRetryableStatus } from '@/lib/calicotab/fetch';

const h = (init: Record<string, string> = {}) => new Headers(init);

describe('isCdnRateLimit', () => {
  test('429 and 503 always mean slow down', () => {
    expect(isCdnRateLimit(429, h())).toBe(true);
    expect(isCdnRateLimit(503, h())).toBe(true);
  });

  test('a CDN-issued 403 means slow down', () => {
    // Cloudflare-fronted installs answer a burst with 403 rather than 429,
    // which is the case the escalation exists for.
    expect(isCdnRateLimit(403, h({ 'cf-ray': '8f2a1b3c4d5e6789-LHR' }))).toBe(true);
    expect(isCdnRateLimit(403, h({ 'cf-mitigated': 'challenge' }))).toBe(true);
    expect(isCdnRateLimit(403, h({ server: 'cloudflare' }))).toBe(true);
  });

  test('an origin 403 is a private page, not throttling', () => {
    // Tabbycat lets a tournament hide its participants list or tabs. That
    // 403 comes straight off the origin (Server: nginx) with an ordinary
    // HTML body, and it will 403 identically forever — treating it as
    // push-back pushed the whole host to a 1.5s-then-3s interval for the
    // rest of the process over a page that is simply not public.
    expect(isCdnRateLimit(403, h({ server: 'nginx' }))).toBe(false);
    expect(isCdnRateLimit(403, h())).toBe(false);
  });

  test('success and missing statuses are never push-back', () => {
    expect(isCdnRateLimit(200, h())).toBe(false);
    expect(isCdnRateLimit(404, h())).toBe(false);
  });
});

describe('isRetryableStatus', () => {
  test('retries the transient server-side statuses', () => {
    for (const s of [408, 425, 429, 500, 502, 503, 504]) {
      expect(isRetryableStatus(s, h())).toBe(true);
    }
  });

  test('retries a CDN 403 but not an origin 403', () => {
    // Same distinction: a Cloudflare block may pass on the retry, a
    // private page never will — and each pointless retry costs a slot.
    expect(isRetryableStatus(403, h({ 'cf-ray': 'abc' }))).toBe(true);
    expect(isRetryableStatus(403, h({ server: 'nginx' }))).toBe(false);
  });

  test('does not retry genuine misses or success', () => {
    expect(isRetryableStatus(404, h())).toBe(false);
    expect(isRetryableStatus(410, h())).toBe(false);
    expect(isRetryableStatus(401, h())).toBe(false);
    expect(isRetryableStatus(200, h())).toBe(false);
  });
});
