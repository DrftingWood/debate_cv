import { beforeEach, describe, expect, it, vi } from 'vitest';

// The audit loader turns a batch of tournaments into AuditInputs with a fixed
// number of queries, whatever the batch size. The database is a plain mock:
// each method returns the rows Postgres would for the where clause given, and
// the test pins both the mapping and the query count.

const db = vi.hoisted(() => ({
  tournament: { findMany: vi.fn() },
  teamResult: { findMany: vi.fn() },
  eliminationResult: { findMany: vi.fn() },
  tournamentParticipant: { groupBy: vi.fn() },
  judgeAssignment: { groupBy: vi.fn() },
  motion: { groupBy: vi.fn() },
  scrapePiece: { findMany: vi.fn() },
  cvErrorReport: { findMany: vi.fn() },
  discoveredUrl: { groupBy: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma: db }));

const { loadAuditInputs } = await import('@/lib/audit/load');

// Decimal columns arrive as objects with toNumber/toString; mimic that.
const dec = (n: number) => ({ toNumber: () => n, toString: () => String(n) });

function seedRows() {
  db.tournament.findMany.mockResolvedValue([
    { id: 1n, format: 'BP', prelimRoundCount: 2, parserVersion: 'v9' },
    { id: 2n, format: null, prelimRoundCount: null, parserVersion: null },
  ]);
  db.teamResult.findMany.mockResolvedValue([
    {
      tournamentId: 1n,
      teamName: 'Oxford A',
      roundNumber: 0,
      points: dec(5),
      wins: null,
      position: null,
    },
    {
      tournamentId: 1n,
      teamName: 'Oxford A',
      roundNumber: 1,
      points: dec(3),
      wins: null,
      position: 'OG',
    },
    {
      tournamentId: 1n,
      teamName: 'Oxford A',
      roundNumber: 2,
      points: null,
      wins: 1,
      position: 'CO',
    },
  ]);
  db.eliminationResult.findMany.mockResolvedValue([
    { tournamentId: 1n, stage: 'Grand Final', entityName: 'Oxford A', result: 'won' },
    { tournamentId: 1n, stage: 'Grand Final', entityName: 'Cam B', result: 'lost' },
    { tournamentId: 1n, stage: 'Open', entityName: 'Oxford A', result: null },
  ]);
}

function seedCounts() {
  db.tournamentParticipant.groupBy.mockImplementation(async (args: { by: string[] }) =>
    args.by.includes('teamName')
      ? [
          { tournamentId: 1n, teamName: 'Oxford A', _count: { _all: 2, speakerScoreTotal: 2 } },
          { tournamentId: 1n, teamName: null, _count: { _all: 1, speakerScoreTotal: 0 } },
          { tournamentId: 2n, teamName: 'Lone', _count: { _all: 1, speakerScoreTotal: 1 } },
        ]
      : [{ tournamentId: 1n, _count: { _all: 4 } }],
  );
  db.judgeAssignment.groupBy.mockImplementation(async (args: { by: string[] }) =>
    args.by.includes('personId')
      ? [
          { tournamentId: 1n, personId: 7n },
          { tournamentId: 1n, personId: 8n },
          { tournamentId: 1n, personId: 9n },
        ]
      : [
          { tournamentId: 1n, roundNumber: 1, panelRole: 'chair', _count: { _all: 2 } },
          { tournamentId: 1n, roundNumber: 1, panelRole: 'panellist', _count: { _all: 3 } },
          { tournamentId: 1n, roundNumber: 1, panelRole: 'trainee', _count: { _all: 1 } },
          { tournamentId: 1n, roundNumber: 2, panelRole: null, _count: { _all: 1 } },
        ],
  );
  db.motion.groupBy.mockResolvedValue([
    { tournamentId: 1n, roundNumber: 2 },
    { tournamentId: 1n, roundNumber: 1 },
  ]);
  db.scrapePiece.findMany.mockResolvedValue([
    {
      tournamentId: 1n,
      kind: 'round',
      key: '1',
      label: 'Round 1',
      status: 'failed',
      url: 'https://x.calicotab.com/t/privateurls/k/',
    },
  ]);
  db.cvErrorReport.findMany.mockResolvedValue([
    { tournamentIds: ['1', '2', '99'], categories: ['wrong_teammate'] },
    { tournamentIds: ['2'], categories: [] },
  ]);
  db.discoveredUrl.groupBy.mockResolvedValue([
    { tournamentId: 1n, userId: 'u1' },
    { tournamentId: 1n, userId: 'u2' },
  ]);
}

beforeEach(() => {
  for (const model of Object.values(db)) for (const fn of Object.values(model)) fn.mockReset();
  seedRows();
  seedCounts();
});

describe('loadAuditInputs', () => {
  it('maps the batch rows into AuditInputs per tournament', async () => {
    const map = await loadAuditInputs([1n, 2n]);
    expect(map.get(1n)).toEqual({
      format: 'BP',
      prelimRoundCount: 2,
      parserVersion: 'v9',
      teamTab: [{ team: 'Oxford A', points: 5, wins: null }],
      roundRows: [
        { team: 'Oxford A', round: 1, points: 3, wins: null, position: 'OG' },
        { team: 'Oxford A', round: 2, points: null, wins: 1, position: 'CO' },
      ],
      outrounds: [
        { stage: 'Grand Final', team: 'Oxford A', result: 'won' },
        { stage: 'Grand Final', team: 'Cam B', result: 'lost' },
      ],
      breakRows: [{ stage: 'Open', team: 'Oxford A' }],
      speakersByTeam: { 'Oxford A': 2 },
      speakerParticipants: 3,
      speakersWithScores: 2,
      judgeParticipants: 4,
      roundResultJudges: 3,
      judgesByRound: { 1: { chairs: 2, judges: 6 }, 2: { chairs: 0, judges: 1 } },
      motionRounds: [1, 2],
      pieces: [
        {
          kind: 'round',
          key: '1',
          label: 'Round 1',
          status: 'failed',
          url: 'https://x.calicotab.com/t/privateurls/k/',
        },
      ],
      openReports: [{ categories: ['wrong_teammate'] }],
      usersAffected: 2,
    });
  });

  it('a tournament with no rows gets empty inputs, and reports reach every id they name', async () => {
    const t2 = (await loadAuditInputs([1n, 2n])).get(2n)!;
    expect(t2).toMatchObject({
      teamTab: [],
      roundRows: [],
      outrounds: [],
      breakRows: [],
      speakersByTeam: { Lone: 1 },
      judgeParticipants: 0,
      roundResultJudges: 0,
      judgesByRound: {},
      motionRounds: [],
      pieces: [],
      usersAffected: 0,
    });
    expect(t2.openReports).toEqual([{ categories: ['wrong_teammate'] }, { categories: [] }]);
  });

  it('leaves out ids with no Tournament row', async () => {
    const map = await loadAuditInputs([1n, 2n, 3n]);
    expect([...map.keys()]).toEqual([1n, 2n]);
  });
});

describe('loadAuditInputs: queries', () => {
  it('queries each table a fixed number of times for the whole batch', async () => {
    await loadAuditInputs([1n, 2n]);
    expect(db.tournament.findMany).toHaveBeenCalledTimes(1);
    expect(db.teamResult.findMany).toHaveBeenCalledTimes(1);
    expect(db.eliminationResult.findMany).toHaveBeenCalledTimes(1);
    expect(db.motion.groupBy).toHaveBeenCalledTimes(1);
    expect(db.scrapePiece.findMany).toHaveBeenCalledTimes(1);
    expect(db.cvErrorReport.findMany).toHaveBeenCalledTimes(1);
    expect(db.discoveredUrl.groupBy).toHaveBeenCalledTimes(1);
    // A role lives on a joined table, and distinct judges need their own
    // grouping: two grouped queries each, still per batch, not per tournament.
    expect(db.tournamentParticipant.groupBy).toHaveBeenCalledTimes(2);
    expect(db.judgeAssignment.groupBy).toHaveBeenCalledTimes(2);
  });

  it('filters in the database: round_results judges, open reports, outcomes and breaks only', async () => {
    await loadAuditInputs([1n, 2n]);
    const ids = { in: [1n, 2n] };
    for (const call of db.judgeAssignment.groupBy.mock.calls) {
      expect(call[0].where).toEqual({
        tournamentId: ids,
        source: 'round_results',
        roundNumber: { not: null },
      });
    }
    expect(db.cvErrorReport.findMany.mock.calls[0][0].where).toEqual({
      status: { in: ['open', 'acknowledged'] },
      tournamentIds: { hasSome: ['1', '2'] },
    });
    expect(db.eliminationResult.findMany.mock.calls[0][0].where).toEqual({
      tournamentId: ids,
      entityType: 'team',
      OR: [{ result: { in: ['won', 'lost'] } }, { result: null }],
    });
  });

  it('an empty batch queries nothing', async () => {
    expect((await loadAuditInputs([])).size).toBe(0);
    expect(db.tournament.findMany).not.toHaveBeenCalled();
  });
});
