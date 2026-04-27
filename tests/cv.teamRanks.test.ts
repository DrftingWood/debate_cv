import { describe, expect, test } from 'vitest';
import { buildTeamRankLookup, teamResultKey } from '@/lib/cv/teamRanks';

const decimal = (value: string) => ({ toString: () => value });

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
