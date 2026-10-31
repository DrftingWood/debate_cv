import { describe, expect, test } from 'vitest';
import {
  actualBreakers,
  mapBreakPage,
  type ApiRoundsTeam,
} from '@/lib/calicotab/tabbycatApiRounds';

// Shaped like GET /break-categories/<id>/break: `rank` is the standing,
// `break_rank` is null for a team that did not break, `remark` says why
// (BreakingTeam.Remark in tabbycat/breakqual/models.py).

const API = 'https://t.calicotab.com/api/v1/tournaments/t';
const T = 'https://t.calicotab.com/t/';
const team = (id: number, short_name: string): ApiRoundsTeam => ({
  url: `${API}/teams/${id}`,
  short_name,
  speakers: [],
});
const teams = [team(1, 'Alpha A'), team(2, 'Beta B'), team(3, 'Gamma C'), team(4, 'Delta D')];

function map(breakingTeams: Parameters<typeof mapBreakPage>[0]['breakingTeams']) {
  return mapBreakPage({
    sourceUrl: `${T}break/teams/open/`,
    breakingTeams,
    teams,
    teamStandings: [],
    adjudicators: [],
  });
}

describe('mapBreakPage — remarks and break_rank', () => {
  test('remarked teams and null break_rank are not breakers; rank is break_rank', () => {
    const rows = map([
      { team: teams[0]!.url, rank: 1, break_rank: 1, remark: '' },
      { team: teams[1]!.url, rank: 2, break_rank: null, remark: 'w' },
      { team: teams[2]!.url, rank: 3, break_rank: 2, remark: null },
      { team: teams[3]!.url, rank: 4, break_rank: null, remark: null },
    ]);
    expect(rows.map((r) => [r.entityName, r.rank])).toEqual([
      ['Alpha A', 1],
      ['Gamma C', 2],
    ]);
  });

  test('a remark alone excludes a team even with a break_rank', () => {
    expect(map([{ team: teams[0]!.url, rank: 1, break_rank: 1, remark: 'd' }])).toEqual([]);
  });

  test('without break_rank or remark (older installs) the rank is used as before', () => {
    const rows = map([{ team: teams[0]!.url, rank: 3 }]);
    expect(rows.map((r) => r.rank)).toEqual([3]);
  });

  test('actualBreakers feeds the consecutive-rank check without the non-breakers', () => {
    const kept = actualBreakers([
      { team: 'a', rank: 1, break_rank: 1 },
      { team: 'b', rank: 2, break_rank: null, remark: 'w' },
      { team: 'c', rank: 3, break_rank: 2 },
    ]);
    expect(kept.map((k) => k.rank)).toEqual([1, 2]);
  });
});
