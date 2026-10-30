import { describe, it, expect, beforeEach, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { getScrapeHealth, getTournamentPieces } = await import('@/lib/admin/scrapeHealth');

const d = (s: string) => new Date(s);

beforeEach(() => resetPrismaMock());

/* eslint-disable max-lines-per-function -- one fixture-heavy scenario */
describe('getScrapeHealth', () => {
  it('counts, groups by kind and splits retries due from stuck', async () => {
    prismaMock.tournament.count.mockResolvedValue(7);
    prismaMock.scrapePiece.count.mockImplementation(
      async ({ where }: { where: { nextRetryAt?: null | { lte: Date } } }) => {
        if (where.nextRetryAt === null) return 1; // stuck
        if (where.nextRetryAt?.lte) return 2; // due
        return 4; // all failing
      },
    );
    prismaMock.scrapePiece.groupBy.mockImplementation(async ({ by }: { by: string[] }) =>
      by[0] === 'kind'
        ? [
            { kind: 'round', _count: { _all: 3 } },
            { kind: 'team', _count: { _all: 1 } },
          ]
        : [
            { tournamentId: 1n, _max: { lastAttemptAt: d('2026-10-01') } },
            { tournamentId: 2n, _max: { lastAttemptAt: d('2026-10-05') } },
          ],
    );
    prismaMock.scrapePiece.findMany.mockResolvedValue([
      {
        tournamentId: 2n,
        kind: 'round',
        key: '3',
        label: 'R3',
        httpStatus: 500,
        attempts: 2,
        nextRetryAt: d('2026-10-06'),
      },
      {
        tournamentId: 1n,
        kind: 'team',
        key: '',
        label: 'Team tab',
        httpStatus: null,
        attempts: 5,
        nextRetryAt: null,
      },
    ]);
    prismaMock.tournament.findMany.mockResolvedValue([
      { id: 1n, name: 'One' },
      { id: 2n, name: 'Two' },
    ]);
    prismaMock.ingestJob.findMany.mockResolvedValue([
      {
        id: 'j1',
        url: 'https://x',
        attempts: 3,
        lastError: 'boom',
        finishedAt: d('2026-10-02'),
        user: { email: 'a@b.c' },
      },
    ]);
    prismaMock.discoveredUrl.findMany.mockResolvedValue([]);

    const h = await getScrapeHealth();
    expect(h).toMatchObject({
      tracked: 7,
      partlyLoaded: 2,
      failingPieces: 4,
      retriesDue: 2,
      stuck: 1,
      failingByKind: [
        { kind: 'round', count: 3 },
        { kind: 'team', count: 1 },
      ],
    });
    // Newest attempt first.
    expect(h.partlyLoadedTournaments.map((t) => t.id)).toEqual([2n, 1n]);
    expect(h.partlyLoadedTournaments[0]).toMatchObject({
      name: 'Two',
      lastAttemptAt: d('2026-10-05'),
      failed: [{ kind: 'round', key: '3', label: 'R3', httpStatus: 500, attempts: 2 }],
    });
    expect(h.failedJobs).toEqual([
      {
        id: 'j1',
        url: 'https://x',
        userEmail: 'a@b.c',
        attempts: 3,
        lastError: 'boom',
        finishedAt: d('2026-10-02'),
        // Not a tab URL, so no tournament can be stored for it.
        stored: null,
        // Task 5c: so nothing of its tab is loaded either.
        tab: { state: 'missing', tournamentId: null, errors: [] },
      },
    ]);
    expect(prismaMock.ingestJob.findMany.mock.calls[0][0]).toMatchObject({
      where: { status: { in: ['failed', 'abandoned'] } },
      take: 200,
    });
  });
});

// Final review (2026-10-31): a withheld page is not a failure. It is counted
// apart, and stays out of every failing count and the partly-loaded list.
describe('getScrapeHealth: withheld pages', () => {
  it('counts withheld pieces apart and asks for failed ones everywhere else', async () => {
    prismaMock.tournament.count.mockResolvedValue(1);
    prismaMock.scrapePiece.count.mockImplementation(
      async ({ where }: { where: { status: string } }) => (where.status === 'withheld' ? 3 : 0),
    );
    prismaMock.scrapePiece.groupBy.mockResolvedValue([]);
    prismaMock.ingestJob.findMany.mockResolvedValue([]);

    const h = await getScrapeHealth();
    expect(h).toMatchObject({ withheld: 3, failingPieces: 0, partlyLoaded: 0, stuck: 0 });
    const statuses = [
      ...prismaMock.scrapePiece.count.mock.calls,
      ...prismaMock.scrapePiece.groupBy.mock.calls,
    ].map((c) => (c[0] as { where: { status: string } }).where.status);
    expect(statuses.filter((s) => s !== 'failed')).toEqual(['withheld']);
  });
});

describe('getTournamentPieces', () => {
  it('returns null for an unknown tournament', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue(null);
    expect(await getTournamentPieces(9n)).toBeNull();
  });

  it('splits tabs from rounds and orders rounds numerically, outrounds last', async () => {
    prismaMock.tournament.findUnique.mockResolvedValue({
      id: 1n,
      name: 'T',
      sourceUrlRaw: 'https://t.calicotab.com/t/',
    });
    const row = (kind: string, key: string, label: string) => ({
      kind,
      key,
      label,
      status: 'ok',
      httpStatus: 200,
      attempts: 0,
      loadedAt: null,
      lastAttemptAt: d('2026-10-01'),
      nextRetryAt: null,
      lastError: null,
    });
    prismaMock.scrapePiece.findMany.mockResolvedValue([
      row('round', '10', 'R10'),
      row('round', '/t/results/round/grand-final/', 'Grand Final'),
      row('round', '2', 'R2'),
      row('team', '', 'Team tab'),
      row('break', 'open', 'Open break'),
    ]);
    const r = await getTournamentPieces(1n);
    expect(r?.tournament).toEqual({ id: 1n, name: 'T', sourceUrl: 'https://t.calicotab.com/t/' });
    expect(r?.tabs.map((p) => p.kind).sort()).toEqual(['break', 'team']);
    expect(r?.rounds.map((p) => p.label)).toEqual(['R2', 'R10', 'Grand Final']);
  });
});
