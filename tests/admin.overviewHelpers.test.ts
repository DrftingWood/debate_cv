import { describe, expect, it, vi } from 'vitest';
import { relativeTime } from '@/lib/utils/relativeTime';
import { rescrapeFailureMessage, retryFailureMessage } from '@/lib/admin/actionMessage';
import { shortUrl } from '@/lib/utils/shortUrl';

const NOW = new Date('2026-10-31T12:00:00Z');
const at = (sec: number) => new Date(NOW.getTime() + sec * 1000);

describe('relativeTime', () => {
  it('says how long ago a past moment was', () => {
    expect(relativeTime(at(-20), NOW)).toBe('just now');
    expect(relativeTime(at(-5 * 60), NOW)).toBe('5 min ago');
    expect(relativeTime(at(-3 * 3600), NOW)).toBe('3 h ago');
    expect(relativeTime(at(-2 * 86400), NOW)).toBe('2 d ago');
  });

  it('says how far off a future moment is', () => {
    expect(relativeTime(at(20), NOW)).toBe('in under a minute');
    expect(relativeTime(at(30 * 60), NOW)).toBe('in 30 min');
    expect(relativeTime(at(5 * 3600), NOW)).toBe('in 5 h');
    expect(relativeTime(at(3 * 86400), NOW)).toBe('in 3 d');
  });

  it('falls back to the date after a month', () => {
    expect(relativeTime(at(-40 * 86400), NOW)).toBe('21 Sept 2026');
  });
});

describe('admin action messages (UX-23)', () => {
  const codeLike = /scrape_busy|not_found|bad_request|server_error|forbidden|unauthorized|HTTP \d/;

  it('names a busy scrape in the words of the brief', () => {
    expect(rescrapeFailureMessage({ status: 409, error: 'scrape_busy' })).toBe(
      'Another scrape of this tournament is running. Try again in a minute.',
    );
  });

  it('maps every route code, a non-JSON body and a network failure to a sentence', () => {
    const cases = [
      { status: 404, error: 'not_found' },
      { status: 400, error: 'bad_request' },
      { status: 401, error: 'unauthorized' },
      { status: 403, error: 'forbidden' },
      { status: 500, error: 'server_error' },
      { status: 504, error: 'HTTP 504' },
      { status: 0, error: 'Failed to fetch' },
    ];
    for (const f of cases) {
      for (const message of [rescrapeFailureMessage(f), retryFailureMessage(f)]) {
        expect(message).toMatch(/^[A-Z].*\.$/);
        expect(message).not.toMatch(codeLike);
      }
    }
  });
});

describe('shortUrl', () => {
  it('hides the private key and the scheme', () => {
    expect(shortUrl('https://oxiv.calicotab.com/oxiv2025/privateurls/abc123/')).toBe(
      'oxiv.calicotab.com/oxiv2025/…',
    );
    // An unreadable string is never echoed: it could still hold a key.
    expect(shortUrl('not a url')).toBe('Unreadable link');
  });
});

describe('singleFlight (UX-17: no double submit)', () => {
  it('sends no second POST while the first is in flight, and allows one after', async () => {
    const { singleFlight } = await import('@/lib/utils/singleFlight');
    const flight = singleFlight();
    let release!: (v: string) => void;
    const post = vi.fn(() => new Promise<string>((r) => (release = r)));

    const first = flight.run(post);
    const second = flight.run(post);
    expect(flight.busy).toBe(true);
    expect(post).toHaveBeenCalledTimes(1);
    expect(await second).toBeUndefined();

    release('ok');
    expect(await first).toBe('ok');
    expect(flight.busy).toBe(false);
    await flight.run(async () => 'again');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('frees itself when the call throws', async () => {
    const { singleFlight } = await import('@/lib/utils/singleFlight');
    const flight = singleFlight();
    await expect(flight.run(async () => Promise.reject(new Error('x')))).rejects.toThrow('x');
    expect(flight.busy).toBe(false);
  });
});
