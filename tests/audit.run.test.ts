import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AuditInputs } from '@/lib/audit/auditInputs';

// runAudit, auditStale and auditAfterScrape over a mocked loader and
// database. The loader's own mapping is in audit.load.test.ts; the checks and
// scorer have their own suites, so here only the wiring between them.

const h = vi.hoisted(() => ({
  load: vi.fn(),
  captureException: vi.fn(),
  db: {
    tournament: { findMany: vi.fn() },
    tournamentAudit: { findMany: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('@/lib/audit/load', () => ({ loadAuditInputs: h.load }));
vi.mock('@/lib/db', () => ({ prisma: h.db }));
vi.mock('@sentry/nextjs', () => ({ captureException: h.captureException }));

const { runAudit, auditStale, auditAfterScrape } = await import('@/lib/audit/run');
const { runChecks, CHECKS_VERSION } = await import('@/lib/audit/checks');
const { scoreTournament } = await import('@/lib/audit/score');
const { PARSER_VERSION } = await import('@/lib/calicotab/version');

type Loaded = AuditInputs & { usersAffected: number };

function inputs(over: Partial<Loaded> = {}): Loaded {
  return {
    format: 'BP',
    prelimRoundCount: 1,
    parserVersion: PARSER_VERSION,
    teamTab: [],
    roundRows: [],
    outrounds: [],
    breakRows: [],
    speakersByTeam: {},
    redactedByTeam: {},
    speakerParticipants: 0,
    speakersWithScores: 0,
    judgeParticipants: 0,
    roundResultJudges: 0,
    judgesByRound: {},
    motionRounds: [],
    pieces: [],
    openReports: [],
    usersAffected: 0,
    ...over,
  };
}

/** A loader that answers every id it is asked for. */
function loadEvery(make: (id: bigint) => ReturnType<typeof inputs> = () => inputs()) {
  h.load.mockImplementation(async (ids: bigint[]) => new Map(ids.map((id) => [id, make(id)])));
}

beforeEach(() => {
  h.load.mockReset();
  h.captureException.mockReset();
  h.db.tournament.findMany.mockReset().mockResolvedValue([]);
  h.db.tournamentAudit.findMany.mockReset().mockResolvedValue([]);
  h.db.tournamentAudit.upsert.mockReset().mockImplementation((args: unknown) => args);
  h.db.$transaction.mockReset().mockImplementation(async (ops: unknown[]) => ops);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('runAudit', () => {
  it('upserts the score from scoreTournament, the checks, users affected and the version', async () => {
    const one = inputs({ usersAffected: 3, openReports: [{ categories: [] }] });
    loadEvery(() => one);
    const before = Date.now();
    expect(await runAudit([5n])).toBe(1);

    const checks = runChecks(one, PARSER_VERSION);
    const args = h.db.tournamentAudit.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ tournamentId: 5n });
    const data = {
      score: scoreTournament(checks, 1),
      checks,
      usersAffected: 3,
      checksVersion: CHECKS_VERSION,
    };
    expect(args.create).toMatchObject({ tournamentId: 5n, ...data });
    expect(args.update).toMatchObject(data);
    expect(args.update.computedAt.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('counts only tournaments the loader found, and writes them in one transaction', async () => {
    h.load.mockResolvedValue(new Map([[1n, inputs()]]));
    expect(await runAudit([1n, 2n])).toBe(1);
    expect(h.db.$transaction).toHaveBeenCalledTimes(1);
    expect(h.db.tournamentAudit.upsert).toHaveBeenCalledTimes(1);
  });

  it('an empty list loads nothing', async () => {
    expect(await runAudit([])).toBe(0);
    expect(h.load).not.toHaveBeenCalled();
  });
});

const ids = (from: number, n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: BigInt(from + i) }));

describe('auditStale', () => {
  it('audits missing tournaments first, then the oldest stale audits, up to the limit', async () => {
    loadEvery();
    h.db.tournament.findMany.mockResolvedValue(ids(1, 2));
    h.db.tournamentAudit.findMany.mockResolvedValue([{ tournamentId: 9n }]);
    expect(await auditStale({ limit: 3, deadline: Date.now() + 60_000 })).toBe(3);

    expect(h.db.tournament.findMany.mock.calls[0][0]).toMatchObject({
      where: { audit: { is: null } },
      take: 3,
    });
    const stale = h.db.tournamentAudit.findMany.mock.calls[0][0];
    expect(stale.take).toBe(1);
    expect(stale.orderBy).toEqual({ computedAt: 'asc' });
    expect(stale.where.OR[1]).toEqual({ checksVersion: { not: CHECKS_VERSION } });
    const cutoff = stale.where.OR[0].computedAt.lt.getTime();
    expect(Date.now() - cutoff).toBeGreaterThanOrEqual(24 * 3600_000 - 1000);
    expect(h.load.mock.calls.flatMap((c) => c[0])).toEqual([1n, 2n, 9n]);
  });

  it('does not look for stale audits when the missing ones fill the limit', async () => {
    loadEvery();
    h.db.tournament.findMany.mockResolvedValue(ids(1, 2));
    await auditStale({ limit: 2, deadline: Date.now() + 60_000 });
    expect(h.db.tournamentAudit.findMany).not.toHaveBeenCalled();
  });

  it('runs in chunks of 25', async () => {
    loadEvery();
    h.db.tournament.findMany.mockResolvedValue(ids(1, 60));
    expect(await auditStale({ limit: 60, deadline: Date.now() + 60_000 })).toBe(60);
    expect(h.load.mock.calls.map((c) => c[0].length)).toEqual([25, 25, 10]);
  });

  it('stops at the deadline: no chunk starts once it has passed', async () => {
    h.db.tournament.findMany.mockResolvedValue(ids(1, 60));
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    h.load.mockImplementation(async (batch: bigint[]) => {
      now += 600; // each chunk takes 600 ms
      return new Map(batch.map((id) => [id, inputs()]));
    });
    expect(await auditStale({ limit: 60, deadline: 2_000 })).toBe(50);
    expect(h.load).toHaveBeenCalledTimes(2);
    vi.mocked(Date.now).mockRestore();
  });

  it('a deadline already past audits nothing', async () => {
    loadEvery();
    h.db.tournament.findMany.mockResolvedValue(ids(1, 5));
    expect(await auditStale({ limit: 5, deadline: Date.now() - 1 })).toBe(0);
    expect(h.load).not.toHaveBeenCalled();
  });
});

describe('auditStale: a tournament whose audit throws', () => {
  it('a chunk that throws is retried one by one: only the bad tournament is skipped', async () => {
    h.db.tournament.findMany.mockResolvedValue(ids(1, 30));
    h.load.mockImplementation(async (batch: bigint[]) => {
      if (batch.includes(3n)) throw new Error('bad data in 3');
      return new Map(batch.map((id) => [id, inputs()]));
    });
    expect(await auditStale({ limit: 30, deadline: Date.now() + 60_000 })).toBe(29);
    const batches = h.load.mock.calls.map((c) => c[0] as bigint[]);
    // The failed chunk of 25, then each of its ids alone, then chunk 2.
    expect(batches[0]).toHaveLength(25);
    expect(batches.slice(1, 26)).toEqual(ids(1, 25).map((t) => [t.id]));
    expect(batches[26]).toEqual(ids(26, 5).map((t) => t.id));
    const written = h.db.tournamentAudit.upsert.mock.calls.map((c) => c[0].where.tournamentId);
    expect(written).not.toContain(3n);
    expect(written).toHaveLength(29);
    expect(console.error).toHaveBeenCalledTimes(1);
  });

  it('the one-by-one retries stop at the deadline', async () => {
    h.db.tournament.findMany.mockResolvedValue(ids(1, 5));
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    h.load.mockImplementation(async (batch: bigint[]) => {
      now += 400;
      if (batch.length > 1) throw new Error('chunk failed');
      return new Map(batch.map((id) => [id, inputs()]));
    });
    // Chunk at 1000 fails (now 1400); ids 1 and 2 run (now 2200); then stop.
    expect(await auditStale({ limit: 5, deadline: 2_000 })).toBe(2);
    vi.mocked(Date.now).mockRestore();
  });
});

describe('auditAfterScrape', () => {
  it('audits the one tournament', async () => {
    loadEvery();
    await auditAfterScrape(4n);
    expect(h.load).toHaveBeenCalledWith([4n]);
  });

  it('catches and reports a failure instead of throwing', async () => {
    h.load.mockRejectedValue(new Error('db down'));
    await expect(auditAfterScrape(4n)).resolves.toBeUndefined();
    expect(h.captureException).toHaveBeenCalledTimes(1);
  });
});
