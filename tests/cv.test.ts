import { describe, expect, test, beforeEach, vi } from 'vitest';
import { prismaMock, resetPrismaMock } from './setup/api-test-utils';

vi.mock('@/lib/db', () => import('./setup/api-test-utils').then((m) => ({ prisma: m.prismaMock })));

const { deepestOutroundLabel, mergeSpeakerCvSignals } = await import('@/lib/cv/speakerSignals');
const { buildTeamRankLookup, teamResultKey } = await import('@/lib/cv/teamRanks');
const { buildCvData } = await import('@/lib/cv/buildCvData');

const decimal = (value: string) => ({ toString: () => value });

beforeEach(() => {
  resetPrismaMock();
});

// ── Speaker CV signal merge ──────────────────────────────────────────

describe('speaker CV signal merge', () => {
  test('preserves private-URL outround evidence when the richer speaker-tab row has scores', () => {
    const merged = mergeSpeakerCvSignals([
      { eliminationReached: null, teamBreakRank: null },
      { eliminationReached: 'Quarterfinals', teamBreakRank: null },
    ]);
    expect(merged).toEqual({
      eliminationReached: 'Quarterfinals',
      teamBreakRank: null,
      broke: true,
    });
  });

  test('keeps the deepest spoken outround across claimed aliases', () => {
    expect(deepestOutroundLabel(['Quarterfinals', 'Semifinals', null])).toBe('Semifinals');
  });

  test('keeps the best break rank even without an outround room', () => {
    expect(
      mergeSpeakerCvSignals([
        { eliminationReached: null, teamBreakRank: 12 },
        { eliminationReached: null, teamBreakRank: 5 },
      ]),
    ).toEqual({
      eliminationReached: null,
      teamBreakRank: 5,
      broke: true,
    });
  });
});

// ── Team rank lookup ─────────────────────────────────────────────────

describe('buildTeamRankLookup', () => {
  test('uses explicit team-tab ranks when present', () => {
    const ranks = buildTeamRankLookup([
      { tournamentId: 1n, teamName: 'Bangalore Bombay Chennai', rank: 1, wins: 5, points: decimal('1374.50') },
      { tournamentId: 1n, teamName: 'Other Team', rank: 2, wins: 4, points: decimal('1300.00') },
    ]);
    expect(ranks.get(teamResultKey(1n, 'Bangalore Bombay Chennai'))).toBe(1);
  });

  test('derives a fallback rank from wins and points for older ingests', () => {
    const ranks = buildTeamRankLookup([
      { tournamentId: 1n, teamName: 'Second', rank: null, wins: 4, points: decimal('1300.00') },
      { tournamentId: 1n, teamName: 'First', rank: null, wins: 5, points: decimal('1200.00') },
      { tournamentId: 1n, teamName: 'Third', rank: null, wins: 4, points: decimal('1200.00') },
    ]);
    expect(ranks.get(teamResultKey(1n, 'First'))).toBe(1);
    expect(ranks.get(teamResultKey(1n, 'Second'))).toBe(2);
    expect(ranks.get(teamResultKey(1n, 'Third'))).toBe(3);
  });

  test('does not invent a fallback rank without a standings set', () => {
    const ranks = buildTeamRankLookup([
      { tournamentId: 1n, teamName: 'Only Known Team', rank: null, wins: 5, points: decimal('1200.00') },
    ]);
    expect(ranks.get(teamResultKey(1n, 'Only Known Team'))).toBeUndefined();
  });
});

// ── buildCvData query gates ──────────────────────────────────────────

describe('buildCvData — discoveredUrl filter (audit #7)', () => {
  test('only pulls URLs that finished ingesting', async () => {
    // Sanity-stub everything else so buildCvData runs to the point we care
    // about. The assertion focuses on the discoveredUrl.findMany WHERE
    // clause — partially-ingested URLs (tournamentId set, ingestedAt null)
    // must NOT leak into the CV.
    prismaMock.user.findUnique.mockResolvedValue({
      name: 'Test',
      email: 't@e.com',
      image: null,
    });
    prismaMock.discoveredUrl.findMany.mockResolvedValue([]);
    prismaMock.person.findMany.mockResolvedValue([]);
    prismaMock.tournamentParticipant.findMany.mockResolvedValue([]);
    prismaMock.teamResult.groupBy.mockResolvedValue([]);
    prismaMock.teamResult.findMany.mockResolvedValue([]);
    prismaMock.judgeAssignment.findMany.mockResolvedValue([]);
    prismaMock.eliminationResult.findMany.mockResolvedValue([]);
    prismaMock.cvErrorReport.findMany.mockResolvedValue([]);

    await buildCvData('user-1');

    const discoveredUrlCall = prismaMock.discoveredUrl.findMany.mock.calls[0]?.[0] as
      | { where: { userId: string; tournamentId: object; ingestedAt: object } }
      | undefined;
    expect(discoveredUrlCall?.where).toEqual(
      expect.objectContaining({
        userId: 'user-1',
        tournamentId: { not: null },
        ingestedAt: { not: null },
      }),
    );
  });
});
