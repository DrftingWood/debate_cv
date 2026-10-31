import { beforeEach, describe, expect, it, vi } from 'vitest';

const { runAudit, captureException } = vi.hoisted(() => ({
  runAudit: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => m.dbMockModule));
vi.mock('@/lib/audit/run', () => ({ runAudit }));
vi.mock('@sentry/nextjs', () => ({ captureException }));

import { prismaMock, resetPrismaMock } from './setup/api-test-utils';
import { fillMissingCores, missingCoreWhere } from '@/lib/admin/coreFill';
import { CORE_BATCH_SIZE, coreFillSummary } from '@/lib/admin/coreFillText';
import type { PieceKind } from '@/lib/calicotab/scrapePieces';
import type { PartialResult, rescrapePieces } from '@/lib/calicotab/partialScrape';

// R10: the Tools tab's bulk fill. The partial re-scrape is injected; the pool,
// the pieces asked for, the counting and the cursor are the real code.

const loaded = (...kinds: PieceKind[]): PartialResult => ({
  tournamentId: 0n,
  loaded: kinds.map((kind) => ({ kind, key: '' })),
  failed: [],
  notOnTab: [],
});

/** Which tournaments name a core after their read: staff-block count, Adj Core count. */
function namesAfter(counts: Record<string, [number, number]>) {
  prismaMock.tournamentStaff.count.mockImplementation(
    async (a: { where: { tournamentId: bigint } }) =>
      counts[String(a.where.tournamentId)]?.[0] ?? 0,
  );
  prismaMock.tournamentParticipant.count.mockImplementation(
    async (a: { where: { tournamentId: bigint } }) =>
      counts[String(a.where.tournamentId)]?.[1] ?? 0,
  );
}

beforeEach(() => {
  resetPrismaMock();
  runAudit.mockReset().mockResolvedValue(undefined);
  captureException.mockReset();
  prismaMock.scrapePiece.findMany.mockResolvedValue([]);
  prismaMock.tournamentParticipant.groupBy.mockResolvedValue([]);
  prismaMock.tournament.count.mockResolvedValue(0);
});

describe('missingCoreWhere', () => {
  it('leaves out tournaments that name a core, whose home page was read, or that withhold the list', () => {
    expect(missingCoreWhere(null)).toEqual({
      ignored: false,
      staff: { none: { role: 'core' } },
      participants: { none: { judgeTypeTag: { equals: 'core', mode: 'insensitive' } } },
      scrapePieces: {
        none: {
          OR: [
            { kind: 'home', status: 'ok' },
            { kind: 'participants', status: 'withheld' },
            { kind: 'home', status: 'withheld' },
          ],
        },
      },
    });
  });

  it('continues past the cursor by id', () => {
    expect(missingCoreWhere(40n)).toMatchObject({ id: { gt: 40n } });
  });
});

describe('fillMissingCores: what it reads', () => {
  it('takes at most 20 tournaments, oldest id first', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([]);
    await fillMissingCores(null);
    expect(CORE_BATCH_SIZE).toBe(20);
    expect(prismaMock.tournament.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 20, orderBy: { id: 'asc' } }),
    );
  });

  it('with nothing in the pool does nothing', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([]);
    const rescrape = vi.fn();
    expect(await fillMissingCores(null, { rescrape })).toEqual({
      found: 0,
      none: 0,
      failed: 0,
      left: 0,
      next: null,
    });
    expect(rescrape).not.toHaveBeenCalled();
  });

  it('reads home only where the list was read, and home plus participants where it was not', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 1n }, { id: 2n }]);
    // 1 has a participants piece that loaded; 2 has neither a piece nor judges.
    prismaMock.scrapePiece.findMany.mockResolvedValue([{ tournamentId: 1n }]);
    namesAfter({ '1': [2, 0], '2': [0, 1] });
    const rescrape = vi.fn<typeof rescrapePieces>(async () => loaded('home', 'participants'));
    await fillMissingCores(null, { rescrape });
    expect(rescrape).toHaveBeenNthCalledWith(1, 1n, [{ kind: 'home', key: '' }], expect.anything());
    expect(rescrape).toHaveBeenNthCalledWith(
      2,
      2n,
      [
        { kind: 'home', key: '' },
        { kind: 'participants', key: '' },
      ],
      expect.anything(),
    );
  });

  it('judges on record count as the list having been read', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 3n }]);
    prismaMock.tournamentParticipant.groupBy.mockResolvedValue([{ tournamentId: 3n }]);
    namesAfter({});
    const rescrape = vi.fn<typeof rescrapePieces>(async () => loaded('home'));
    await fillMissingCores(null, { rescrape });
    expect(rescrape.mock.calls[0]![1]).toEqual([{ kind: 'home', key: '' }]);
  });
});

describe('fillMissingCores: results', () => {
  it('counts found, none named and failed, and re-audits those it read', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([
      { id: 1n },
      { id: 2n },
      { id: 3n },
      { id: 4n },
    ]);
    prismaMock.tournament.count.mockResolvedValue(7);
    namesAfter({ '1': [3, 0], '2': [0, 0] });
    const rescrape = vi.fn<typeof rescrapePieces>(async (id: bigint) => {
      if (id === 3n) throw Object.assign(new Error('x'), { name: 'ScrapeBusyError' });
      if (id === 4n) return { ...loaded(), failed: [{ kind: 'home' as const, key: '' }] };
      return loaded('home');
    });
    const out = await fillMissingCores(null, { rescrape });
    expect(out).toEqual({ found: 1, none: 1, failed: 2, left: 7, next: '4' });
    expect(coreFillSummary(out)).toBe('Found 1 · none named 1 · failed 2 · 7 left');
    // Re-audited: the two it read, not the one that was busy.
    expect(runAudit).toHaveBeenCalledWith([1n, 2n, 4n]);
    // A busy tournament is expected and not reported.
    expect(captureException).not.toHaveBeenCalled();
  });

  it('a home page the tournament has taken down is "none named", not a failure', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 1n }]);
    const rescrape = vi.fn<typeof rescrapePieces>(async () => ({
      ...loaded(),
      notOnTab: [{ kind: 'home' as const, key: '' }],
    }));
    const out = await fillMissingCores(null, { rescrape });
    expect(out).toMatchObject({ found: 0, none: 1, failed: 0 });
  });

  it('reports an unexpected error by code and goes on', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 1n }, { id: 2n }]);
    namesAfter({ '2': [1, 0] });
    const rescrape = vi.fn<typeof rescrapePieces>(async (id: bigint) => {
      if (id === 1n) throw new Error('boom');
      return loaded('home');
    });
    const out = await fillMissingCores(null, { rescrape });
    expect(out).toMatchObject({ found: 1, failed: 1 });
    expect(captureException).toHaveBeenCalledTimes(1);
  });

  it('the cursor is the last tournament handled, null when none are left', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 10n }, { id: 11n }]);
    namesAfter({ '10': [1, 0], '11': [1, 0] });
    prismaMock.tournament.count.mockResolvedValue(0);
    const out = await fillMissingCores(5n, { rescrape: async () => loaded('home') });
    expect(out.next).toBeNull();
    expect(prismaMock.tournament.count).toHaveBeenCalledWith({ where: missingCoreWhere(11n) });
  });

  it('stops starting tournaments when the time is nearly up, and continues from the last one it did', async () => {
    prismaMock.tournament.findMany.mockResolvedValue([{ id: 1n }, { id: 2n }, { id: 3n }]);
    prismaMock.tournament.count.mockResolvedValue(2);
    namesAfter({ '1': [1, 0] });
    const rescrape = vi.fn<typeof rescrapePieces>(async () => loaded('home'));
    // Deadline already inside the re-audit tail: nothing is started.
    const out = await fillMissingCores(null, { rescrape, deadline: Date.now() + 1_000 });
    expect(rescrape).not.toHaveBeenCalled();
    expect(out).toMatchObject({ found: 0, none: 0, failed: 0, left: 2, next: '0' });
  });
});
