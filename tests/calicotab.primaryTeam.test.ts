import { describe, expect, test } from 'vitest';
import { buildPrimaryTeamMap } from '@/lib/calicotab/primaryTeam';
import type { SpeakerTabRow } from '@/lib/calicotab/parseTabs';

function row(
  teamName: string | null,
  scoredRounds: number,
  speakerName = 'X',
): SpeakerTabRow {
  return {
    rank: null,
    rankEsl: null,
    rankEfl: null,
    speakerName,
    teamName,
    institution: null,
    totalScore: null,
    roundScores: Array.from({ length: scoredRounds }, () => ({
      roundLabel: 'R1',
      score: 75,
      positionLabel: null,
    })),
  };
}

describe('buildPrimaryTeamMap (audit #14 resort-stable iron-man team)', () => {
  test('non-iron-man speaker keeps their single team', () => {
    const map = buildPrimaryTeamMap([
      { row: row('Alpha', 5), lookupId: BigInt(1) },
    ]);
    expect(map.get(BigInt(1))).toBe('Alpha');
  });

  test('iron-man speaker gets the team with the most scored rounds', () => {
    // Speaker spent 5 rounds with Alpha, 1 round (sub) with Beta. Alpha
    // is primary regardless of which row appears first in the tab.
    const map = buildPrimaryTeamMap([
      { row: row('Alpha', 5), lookupId: BigInt(1) },
      { row: row('Beta', 1), lookupId: BigInt(1) },
    ]);
    expect(map.get(BigInt(1))).toBe('Alpha');
  });

  test('result is stable when input row order is reversed (resort-stability)', () => {
    const a = buildPrimaryTeamMap([
      { row: row('Alpha', 5), lookupId: BigInt(1) },
      { row: row('Beta', 1), lookupId: BigInt(1) },
    ]);
    const b = buildPrimaryTeamMap([
      { row: row('Beta', 1), lookupId: BigInt(1) },
      { row: row('Alpha', 5), lookupId: BigInt(1) },
    ]);
    expect(a.get(BigInt(1))).toBe(b.get(BigInt(1)));
  });

  test('handles different lookupIds independently', () => {
    const map = buildPrimaryTeamMap([
      { row: row('Alpha', 5, 'A'), lookupId: BigInt(1) },
      { row: row('Beta', 4, 'B'), lookupId: BigInt(2) },
      { row: row('Gamma', 2, 'B'), lookupId: BigInt(2) },
    ]);
    expect(map.get(BigInt(1))).toBe('Alpha');
    expect(map.get(BigInt(2))).toBe('Beta');
  });

  test('returns no entry for an empty input', () => {
    const map = buildPrimaryTeamMap([]);
    expect(map.size).toBe(0);
  });

  test('handles null teamName entries (e.g., participant with no recorded team)', () => {
    const map = buildPrimaryTeamMap([
      { row: row(null, 3), lookupId: BigInt(1) },
    ]);
    expect(map.get(BigInt(1))).toBeNull();
  });

  test('zero-scored-round rows still contribute the team if it is the only one', () => {
    // A speaker with no parsed scored rounds (e.g., only reply or
    // average-only tab) still resolves to their team rather than null.
    const map = buildPrimaryTeamMap([
      { row: row('Alpha', 0), lookupId: BigInt(1) },
    ]);
    expect(map.get(BigInt(1))).toBe('Alpha');
  });
});
