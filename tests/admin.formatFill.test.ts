import { beforeEach, describe, expect, it, vi } from 'vitest';

// Task R9: inferring a missing Tournament.format from what is stored. The
// database is a mock whose rows have the shapes the loader selects; the
// inference itself (inferTournamentFormat) is the real one, so these cases
// are real-shape fixtures: BP four-team rooms, two-team AP and WSDC, and a
// tournament the stored data cannot settle.

const db = vi.hoisted(() => ({
  tournament: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
  teamResult: { findMany: vi.fn() },
  tournamentParticipant: { groupBy: vi.fn() },
}));
const runAudit = vi.hoisted(() => vi.fn());
vi.mock('@/lib/db', () => ({ prisma: db }));
vi.mock('@/lib/audit/run', () => ({ runAudit }));

const { inferStoredFormats, fillFormats, fillMissingBatch, FILL_BATCH } =
  await import('@/lib/admin/formatFill');

type Row = { tournamentId: bigint; roundNumber: number; position: string | null };
const rooms = (id: bigint, seats: string[], rounds = 2): Row[] =>
  Array.from({ length: rounds }, (_, r) =>
    seats.map((position) => ({ tournamentId: id, roundNumber: r + 1, position })),
  ).flat();
/** `teams` teams of `size` speakers each, as the participant grouping returns them. */
const squads = (id: bigint, teams: number, size: number): Group[] =>
  Array.from({ length: teams }, (_, i) => ({
    tournamentId: id,
    teamName: `Team ${i}`,
    _count: { _all: size },
  }));

type Group = { tournamentId: bigint; teamName: string | null; _count: { _all: number } };
const BP = ['OG', 'OO', 'CG', 'CO'];

function seed(
  tournaments: Array<{ id: bigint; name: string; format?: string | null }>,
  results: Row[],
  groups: Group[],
) {
  db.tournament.findMany.mockResolvedValue(
    tournaments.map((t) => ({ id: t.id, name: t.name, format: t.format ?? null })),
  );
  db.teamResult.findMany.mockResolvedValue(results);
  db.tournamentParticipant.groupBy.mockResolvedValue(groups);
}

beforeEach(() => {
  vi.clearAllMocks();
  db.tournament.updateMany.mockResolvedValue({ count: 1 });
  runAudit.mockResolvedValue(1);
});

describe('inferStoredFormats', () => {
  it('reads four-team rooms as British Parliamentary', async () => {
    seed([{ id: 1n, name: 'Spring Open' }], rooms(1n, BP), squads(1n, 8, 2));
    expect((await inferStoredFormats([1n])).get('1')).toBe('British Parliamentary');
  });

  it('reads Government/Opposition rooms of three-speaker teams as Asian Parliamentary', async () => {
    seed([{ id: 2n, name: 'Cup' }], rooms(2n, ['Government', 'Opposition']), squads(2n, 6, 3));
    expect((await inferStoredFormats([2n])).get('2')).toBe('Asian Parliamentary');
  });

  it('reads Proposition/Opposition rooms of three-speaker teams as World Schools', async () => {
    seed([{ id: 3n, name: 'Cup' }], rooms(3n, ['Proposition', 'Opposition']), squads(3n, 6, 3));
    expect((await inferStoredFormats([3n])).get('3')).toBe('World Schools');
  });

  it('is undecided when nothing stored settles it', async () => {
    seed([{ id: 4n, name: 'Open' }], rooms(4n, ['Pro', 'Con']), squads(4n, 6, 4));
    expect((await inferStoredFormats([4n])).get('4')).toBeNull();
  });

  it('is undecided for a tournament with no rows at all', async () => {
    seed([{ id: 5n, name: 'Open' }], [], []);
    expect((await inferStoredFormats([5n])).get('5')).toBeNull();
  });

  it('keeps tournaments apart in one batch', async () => {
    seed(
      [
        { id: 1n, name: 'A' },
        { id: 2n, name: 'B' },
      ],
      [...rooms(1n, BP), ...rooms(2n, ['Pro', 'Con'])],
      [...squads(1n, 8, 2), ...squads(2n, 6, 4)],
    );
    const got = await inferStoredFormats([1n, 2n]);
    expect(got.get('1')).toBe('British Parliamentary');
    expect(got.get('2')).toBeNull();
  });

  it('asks the database in bulk, not once per tournament', async () => {
    seed([], [], []);
    await inferStoredFormats([1n, 2n, 3n]);
    expect(db.tournament.findMany).toHaveBeenCalledTimes(1);
    expect(db.teamResult.findMany).toHaveBeenCalledTimes(1);
    expect(db.tournamentParticipant.groupBy).toHaveBeenCalledTimes(1);
    const where = db.teamResult.findMany.mock.calls[0]![0].where;
    expect(where.roundNumber).toEqual({ gte: 1 });
  });
});

describe('no readable sides (ruling 14: a wrong format is worse than a null one)', () => {
  const blank = (id: bigint, position: string | null): Row[] =>
    rooms(id, ['x', 'y']).map((r) => ({ ...r, position }));

  it.each([2, 3])('null seats and squads of %i stay undecided, never BP or Asian', async (size) => {
    seed([{ id: 6n, name: 'Open' }], blank(6n, null), squads(6n, 8, size));
    expect((await inferStoredFormats([6n])).get('6')).toBeNull();
  });

  it('blank seats are no better than null ones', async () => {
    seed([{ id: 6n, name: 'Open' }], blank(6n, '  '), squads(6n, 8, 2));
    expect((await inferStoredFormats([6n])).get('6')).toBeNull();
  });

  it('a name that states the format still decides without seats', async () => {
    seed([{ id: 6n, name: 'Cambridge Asian Parliamentary' }], blank(6n, null), squads(6n, 8, 3));
    expect((await inferStoredFormats([6n])).get('6')).toBe('Asian Parliamentary');
  });

  it('fillFormats leaves such a tournament null and unaudited', async () => {
    seed([{ id: 6n, name: 'Open' }], blank(6n, null), squads(6n, 8, 2));
    const out = await fillFormats([6n]);
    expect(out.undecided).toEqual([6n]);
    expect(db.tournament.updateMany).not.toHaveBeenCalled();
  });

  it('skips a speaker group with no team name', async () => {
    seed([{ id: 2n, name: 'Cup' }], rooms(2n, ['Government', 'Opposition']), [
      ...squads(2n, 6, 3),
      { tournamentId: 2n, teamName: null, _count: { _all: 40 } },
    ]);
    expect((await inferStoredFormats([2n])).get('2')).toBe('Asian Parliamentary');
  });
});

describe('fillFormats', () => {
  it('writes decided formats only where still null, then re-audits them', async () => {
    seed(
      [
        { id: 1n, name: 'A' },
        { id: 2n, name: 'B' },
      ],
      [...rooms(1n, BP), ...rooms(2n, ['Pro', 'Con'])],
      [...squads(1n, 8, 2), ...squads(2n, 6, 4)],
    );
    const out = await fillFormats([1n, 2n]);
    expect(out.filled).toEqual([{ id: 1n, format: 'British Parliamentary' }]);
    expect(out.undecided).toEqual([2n]);
    expect(db.tournament.updateMany).toHaveBeenCalledTimes(1);
    expect(db.tournament.updateMany).toHaveBeenCalledWith({
      where: { id: 1n, format: null },
      data: { format: 'British Parliamentary' },
    });
    expect(runAudit).toHaveBeenCalledWith([1n]);
  });

  it('leaves a tournament that already has a format alone', async () => {
    seed([{ id: 1n, name: 'A', format: 'Australs' }], rooms(1n, BP), squads(1n, 8, 2));
    const out = await fillFormats([1n]);
    expect(out).toEqual({ filled: [], undecided: [], already: [1n] });
    expect(db.tournament.updateMany).not.toHaveBeenCalled();
    expect(runAudit).not.toHaveBeenCalled();
  });

  it('does not audit when nothing was filled', async () => {
    seed([{ id: 4n, name: 'Open' }], rooms(4n, ['Pro', 'Con']), squads(4n, 6, 4));
    await fillFormats([4n]);
    expect(runAudit).not.toHaveBeenCalled();
  });

  it('counts a row another writer filled in the meantime as not filled', async () => {
    seed([{ id: 1n, name: 'A' }], rooms(1n, BP), squads(1n, 8, 2));
    db.tournament.updateMany.mockResolvedValue({ count: 0 });
    const out = await fillFormats([1n]);
    expect(out).toEqual({ filled: [], undecided: [], already: [1n] });
    expect(runAudit).not.toHaveBeenCalled();
  });
});

describe('fillMissingBatch', () => {
  it('takes the oldest ids after the cursor, bounded, and says how many are left', async () => {
    db.tournament.findMany.mockResolvedValueOnce([{ id: 7n }, { id: 9n }]).mockResolvedValueOnce([
      { id: 7n, name: 'A', format: null },
      { id: 9n, name: 'B', format: null },
    ]);
    db.teamResult.findMany.mockResolvedValue([...rooms(7n, BP), ...rooms(9n, ['Pro', 'Con'])]);
    db.tournamentParticipant.groupBy.mockResolvedValue([...squads(7n, 8, 2), ...squads(9n, 6, 4)]);
    db.tournament.count.mockResolvedValue(4);
    const out = await fillMissingBatch(5n);
    expect(db.tournament.findMany.mock.calls[0]![0]).toMatchObject({
      where: { format: null, id: { gt: 5n } },
      orderBy: { id: 'asc' },
      take: FILL_BATCH,
    });
    expect(out).toEqual({ filled: 1, undecided: 1, left: 4, next: '9' });
    expect(db.tournament.count).toHaveBeenCalledWith({
      where: { format: null, id: { gt: 9n } },
    });
  });

  it('a full batch with more behind it hands back the last id as the cursor', async () => {
    const ids = Array.from({ length: FILL_BATCH }, (_, i) => ({ id: BigInt(100 + i) }));
    db.tournament.findMany
      .mockResolvedValueOnce(ids)
      .mockResolvedValueOnce(ids.map((t) => ({ id: t.id, name: 'X', format: null })));
    db.teamResult.findMany.mockResolvedValue([]);
    db.tournamentParticipant.groupBy.mockResolvedValue([]);
    db.tournament.count.mockResolvedValue(12);
    const out = await fillMissingBatch(null);
    expect(out).toEqual({ filled: 0, undecided: FILL_BATCH, left: 12, next: '149' });
  });

  it('with nothing missing, reports zero and no cursor', async () => {
    db.tournament.findMany.mockResolvedValueOnce([]);
    expect(await fillMissingBatch(null)).toEqual({ filled: 0, undecided: 0, left: 0, next: null });
  });
});
