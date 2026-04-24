import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { __test__ } from '@/lib/calicotab/fetch';

const { browserHeaders, DEFAULT_USER_AGENT } = __test__;

describe('browserHeaders', () => {
  const originalUa = process.env.TABBYCAT_USER_AGENT;

  beforeEach(() => {
    delete process.env.TABBYCAT_USER_AGENT;
  });
  afterEach(() => {
    if (originalUa === undefined) delete process.env.TABBYCAT_USER_AGENT;
    else process.env.TABBYCAT_USER_AGENT = originalUa;
    vi.restoreAllMocks();
  });

  test('sends a realistic Chrome User-Agent by default, not the old bot UA', () => {
    const h = browserHeaders();
    expect(h['User-Agent']).toBe(DEFAULT_USER_AGENT);
    // Guard against regressing to the UA Cloudflare was blocking.
    expect(h['User-Agent']).not.toMatch(/debate-cv/i);
    expect(h['User-Agent']).toMatch(/Mozilla\/5\.0/);
    expect(h['User-Agent']).toMatch(/Chrome\//);
  });

  test('advertises a real Accept + Accept-Language so Cloudflare trusts the fingerprint', () => {
    const h = browserHeaders();
    expect(h['Accept']).toContain('text/html');
    expect(h['Accept-Language']).toBe('en-US,en;q=0.9');
    expect(h['Accept-Encoding']).toMatch(/gzip/);
    expect(h['Upgrade-Insecure-Requests']).toBe('1');
    expect(h['Sec-Fetch-Mode']).toBe('navigate');
    expect(h['Sec-Fetch-Site']).toBe('none');
  });

  test('attaches a Referer when provided and flips Sec-Fetch-Site to same-origin', () => {
    const h = browserHeaders('https://x.calicotab.com/t/privateurls/abc/');
    expect(h.Referer).toBe('https://x.calicotab.com/t/privateurls/abc/');
    expect(h['Sec-Fetch-Site']).toBe('same-origin');
  });

  test('TABBYCAT_USER_AGENT env overrides the default', () => {
    process.env.TABBYCAT_USER_AGENT = 'Custom/1.0';
    expect(browserHeaders()['User-Agent']).toBe('Custom/1.0');
  });
});
