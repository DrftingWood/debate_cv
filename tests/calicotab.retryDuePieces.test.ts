import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn(), captureException: vi.fn() }));

import { prismaMock, resetPrismaMock } from './setup/api-test-utils';
import { retryDuePieces, ScrapeBusyError } from '@/lib/calicotab/partialScrape';

beforeEach(() => {
  resetPrismaMock();
});

const GROUPS = [
  { tournamentId: 7n },
  { tournamentId: 9n },
  { tournamentId: 1n },
  { tournamentId: 2n },
  { tournamentId: 3n },
];
const callsOf = (fn: { mock: { calls: unknown[][] } }) =>
  fn.mock.calls.map((c) => c[0] as Record<string, any>); // eslint-disable-line @typescript-eslint/no-explicit-any

describe('retryDuePieces', () => {
  const NOW = new Date('2025-04-01T12:00:00Z');
  const done = (id: bigint) => ({ tournamentId: id, loaded: [], failed: [], notOnTab: [] });

  it('retries due pieces one tournament at a time', async () => {
    prismaMock.scrapePiece.groupBy.mockResolvedValue(GROUPS);
    prismaMock.scrapePiece.findMany.mockResolvedValue([
      { tournamentId: 7n, kind: 'round', key: '2' },
      { tournamentId: 9n, kind: 'team', key: '' },
      { tournamentId: 7n, kind: 'break', key: 'open' },
    ]);
    const rescrape = vi.fn(async (id: bigint, _refs?: unknown) => ({
      ...done(id),
      loaded: [{ kind: 'team' as const, key: '' }],
    }));
    const out = await retryDuePieces({ deadline: Date.now() + 60_000, now: NOW, rescrape });
    expect(rescrape.mock.calls.map((c) => [c[0], c[1]])).toEqual([
      [
        7n,
        [
          { kind: 'round', key: '2' },
          { kind: 'break', key: 'open' },
        ],
      ],
      [9n, [{ kind: 'team', key: '' }]],
    ]);
    expect(out).toEqual({ tournaments: 2, loaded: 2, failed: 0 });
  });

  it('stops when the deadline is near', async () => {
    prismaMock.scrapePiece.groupBy.mockResolvedValue(GROUPS);
    prismaMock.scrapePiece.findMany.mockResolvedValue([
      { tournamentId: 7n, kind: 'round', key: '2' },
    ]);
    const rescrape = vi.fn();
    const out = await retryDuePieces({ deadline: Date.now() + 10_000, now: NOW, rescrape });
    expect(rescrape).not.toHaveBeenCalled();
    expect(out.tournaments).toBe(0);
  });

  it('a piece not due is not retried', async () => {
    prismaMock.scrapePiece.groupBy.mockResolvedValue([]);
    await retryDuePieces({ deadline: Date.now() + 60_000, now: NOW, rescrape: vi.fn() });
    expect(callsOf(prismaMock.scrapePiece.groupBy)[0]).toMatchObject({
      where: { status: 'failed', nextRetryAt: { lte: NOW } },
      orderBy: { _min: { nextRetryAt: 'asc' } },
    });
    expect(prismaMock.scrapePiece.findMany).not.toHaveBeenCalled();
  });
});

describe('retryDuePieces: failures', () => {
  const NOW = new Date('2025-04-01T12:00:00Z');
  const done = (id: bigint) => ({ tournamentId: id, loaded: [], failed: [], notOnTab: [] });

  it('skips a busy tournament and continues past a failing one', async () => {
    prismaMock.scrapePiece.groupBy.mockResolvedValue(GROUPS);
    prismaMock.scrapePiece.findMany.mockResolvedValue([
      { tournamentId: 1n, kind: 'team', key: '' },
      { tournamentId: 2n, kind: 'team', key: '' },
      { tournamentId: 3n, kind: 'team', key: '' },
    ]);
    const rescrape = vi.fn(async (id: bigint) => {
      if (id === 1n) throw new ScrapeBusyError('x');
      if (id === 2n) throw new Error('boom');
      return { ...done(id), failed: [{ kind: 'team' as const, key: '' }] };
    });
    const out = await retryDuePieces({ deadline: Date.now() + 60_000, now: NOW, rescrape });
    expect(rescrape).toHaveBeenCalledTimes(3);
    expect(out).toEqual({ tournaments: 1, loaded: 0, failed: 1 });
  });
});

describe('retryDuePieces: bounds and deadlines', () => {
  const NOW = new Date('2025-04-01T12:00:00Z');

  it('bounds the query to a few tournaments and loads only their pieces', async () => {
    prismaMock.scrapePiece.groupBy.mockResolvedValue([{ tournamentId: 4n }]);
    prismaMock.scrapePiece.findMany.mockResolvedValue([]);
    await retryDuePieces({ deadline: Date.now() + 60_000, now: NOW, rescrape: vi.fn() });
    expect(callsOf(prismaMock.scrapePiece.groupBy)[0]!.take).toBe(20);
    expect(callsOf(prismaMock.scrapePiece.findMany)[0]!.where.tournamentId).toEqual({ in: [4n] });
  });

  it('stops quietly on a deadline error', async () => {
    prismaMock.scrapePiece.groupBy.mockResolvedValue(GROUPS);
    prismaMock.scrapePiece.findMany.mockResolvedValue([
      { tournamentId: 1n, kind: 'team', key: '' },
      { tournamentId: 2n, kind: 'team', key: '' },
    ]);
    const err = new Error('late');
    err.name = 'IngestDeadlineError';
    const rescrape = vi.fn(async () => {
      throw err;
    });
    const Sentry = await import('@sentry/nextjs');
    vi.mocked(Sentry.captureException).mockClear();
    await retryDuePieces({ deadline: Date.now() + 60_000, now: NOW, rescrape });
    expect(rescrape).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });
});
