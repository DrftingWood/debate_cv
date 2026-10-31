import { describe, expect, it, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

// Review leftovers on the parser-warnings read: /admin and the review set
// share one read per request (React cache), and a flag whose warning has
// aged out of the window keeps a scrubbed parser and headline.

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

// Outside a server render React's cache() does not memoise, so this stands
// in for the request scope a server component gets: one memo per argument.
vi.mock('react', async (orig) => {
  const real = await orig<typeof import('react')>();
  const cache = <A extends unknown[], R>(fn: (...a: A) => R) => {
    const memo = new Map<string, R>();
    return (...a: A) => {
      const k = JSON.stringify(a);
      if (!memo.has(k)) memo.set(k, fn(...a));
      return memo.get(k)!;
    };
  };
  return { ...real, cache };
});

const { listParserWarnings, warningDetails, warningWindowStart } =
  await import('@/lib/admin/parserWarnings');

const KEY = 'k3yS3cr3t';

describe('one parser-warnings read per request', () => {
  it('floors the window to the minute, so two clocks a few seconds apart share a key', () => {
    const a = warningWindowStart(new Date('2026-10-31T12:00:05Z'));
    const b = warningWindowStart(new Date('2026-10-31T12:00:55Z'));
    expect(a).toBe(b);
    expect(a).toBe(new Date('2026-10-01T12:00:00Z').getTime());
  });

  it('answers the ledger and the review set from one query', async () => {
    resetPrismaMock();
    prismaMock.parserRun.findMany.mockResolvedValue([]);
    await listParserWarnings({ page: 1, now: new Date('2026-10-31T13:00:01Z') });
    await warningDetails(['parseTabs|x'], new Date('2026-10-31T13:00:40Z'));
    expect(prismaMock.parserRun.findMany).toHaveBeenCalledTimes(1);
  });

  it('scrubs the parser and headline of a flag whose warning has aged out', async () => {
    resetPrismaMock();
    prismaMock.parserRun.findMany.mockResolvedValue([]);
    const key = `parseTabs|Bad row at https://oxiv.calicotab.com/oxiv2025/privateurls/${KEY}/`;
    const out = await warningDetails([key], new Date('2026-10-31T14:00:00Z'));
    const d = out.get(key)!;
    expect(d.count).toBeNull();
    expect(d.parser).toBe('parseTabs');
    expect(d.headline).toContain('https://oxiv.calicotab.com/oxiv2025/');
    expect(JSON.stringify(d)).not.toContain(KEY);
  });
});
