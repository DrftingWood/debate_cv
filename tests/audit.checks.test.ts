import { describe, expect, it } from 'vitest';
import { minSpeakers, runChecks, teamsPerRoom } from '@/lib/audit/checks';
import {
  bpRows,
  check,
  inputs,
  keys,
  names,
  PARSER,
  piece,
  tabFromRows,
} from './fixtures/auditInputs';

// The prelim-round checks. Outround, report and tab checks are in
// audit.checks.outrounds.test.ts. Thresholds come verbatim from
// docs/superpowers/specs/2026-10-31-data-accuracy-design.md.

describe('runChecks', () => {
  it('returns one result per check, in the spec order, user reports last', () => {
    expect(runChecks(inputs(), PARSER).map((c) => c.code)).toEqual([
      'champion',
      'rounds_complete',
      'rooms_consistent',
      'team_coverage',
      'partners',
      'panels',
      'points_add_up',
      'outround_shape',
      'break_matches',
      'speaker_tab',
      'motions',
      'scrape_incomplete',
      'parser_stale',
      'user_reports',
    ]);
  });

  it('no team tab: team_coverage fails, no crash', () => {
    const c = check(inputs({ roundRows: bpRows([8, 8, 8]) }), 'team_coverage');
    expect(c.status).toBe('fail');
    expect(c.detail).toBe('There is no team tab.');
    expect(keys(c)).toEqual(['team:', 'round:1']);
  });

  it('details never carry a raw check code', () => {
    for (const c of runChecks(
      inputs({ openReports: [{ categories: ['wrong_outround'] }] }),
      PARSER,
    )) {
      expect(c.detail).not.toMatch(/[a-z]+_[a-z]+/);
    }
  });
});

describe('teamsPerRoom and minSpeakers', () => {
  it('BP by format or by OG/OO/CG/CO positions; otherwise two', () => {
    expect(teamsPerRoom('British Parliamentary', [])).toBe(4);
    expect(teamsPerRoom(null, [{ position: 'cg' }])).toBe(4);
    expect(teamsPerRoom('Asian Parliamentary', [{ position: 'Gov' }])).toBe(2);
    expect(teamsPerRoom(null, [])).toBe(2);
  });
  it('three for Asian, World Schools and Australs; two otherwise', () => {
    expect(minSpeakers('Asian Parliamentary')).toBe(3);
    expect(minSpeakers('World Schools')).toBe(3);
    expect(minSpeakers('Australs')).toBe(3);
    expect(minSpeakers('British Parliamentary')).toBe(2);
    expect(minSpeakers(null)).toBe(2);
  });
});

describe('rounds_complete', () => {
  it('pass when every prelim round has rows', () => {
    expect(check(inputs({ roundRows: bpRows([8, 8, 8]) }), 'rounds_complete').status).toBe('pass');
  });
  it('fail naming the missing round, suggesting a round piece even when none is recorded', () => {
    const rows = bpRows([8, 8, 8]).filter((r) => r.round !== 2);
    const c = check(inputs({ roundRows: rows }), 'rounds_complete');
    expect(c.status).toBe('fail');
    expect(c.detail).toBe('R2 has no results, out of 3 prelim rounds.');
    expect(c.pieces).toEqual([{ kind: 'round', key: '2', label: 'R2', url: null }]);
  });
  it('uses the recorded piece and its public URL when there is one', () => {
    const rows = bpRows([8, 8, 8]).filter((r) => r.round !== 2);
    const p = { ...piece('round', '2', 'R2'), url: 'https://x.calicotab.com/t/privateurls/abc/' };
    const c = check(inputs({ roundRows: rows, pieces: [p] }), 'rounds_complete');
    expect(c.pieces).toEqual([
      { kind: 'round', key: '2', label: 'R2', url: 'https://x.calicotab.com/t/' },
    ]);
  });
  it('na when the round count is unknown and no rows are stored', () => {
    expect(check(inputs({ prelimRoundCount: null }), 'rounds_complete').status).toBe('na');
  });
});

describe('rooms_consistent', () => {
  it('pass when every round has the same rooms', () => {
    const c = check(inputs({ roundRows: bpRows([64, 64, 64]) }), 'rooms_consistent');
    expect(c.status).toBe('pass');
    expect(c.detail).toBe('All 3 prelim rounds have 16 rooms.');
  });
  it('16/16/12 rooms fails naming R3', () => {
    const c = check(inputs({ roundRows: bpRows([64, 64, 48]) }), 'rooms_consistent');
    expect(c.status).toBe('fail');
    expect(c.detail).toBe('R3 has 12 rooms; the other rounds have 16.');
    expect(keys(c)).toEqual(['round:3']);
  });
  it('one room off within 10% warns', () => {
    const c = check(inputs({ roundRows: bpRows([64, 64, 60]) }), 'rooms_consistent');
    expect(c.status).toBe('warn');
  });
  it('one room off but over 10% fails', () => {
    expect(check(inputs({ roundRows: bpRows([32, 32, 28]) }), 'rooms_consistent').status).toBe(
      'fail',
    );
  });
  it('a swing team rounds up, so 61 BP teams is 16 rooms', () => {
    expect(check(inputs({ roundRows: bpRows([64, 61, 64]) }), 'rooms_consistent').status).toBe(
      'pass',
    );
  });
  it('an even count uses the true median: 16/16/12/12 is a median of 14', () => {
    const c = check(
      inputs({ prelimRoundCount: 4, roundRows: bpRows([64, 64, 48, 48]) }),
      'rooms_consistent',
    );
    expect(c.status).toBe('fail');
    expect(c.detail).toBe(
      'R1 has 16 rooms, R2 has 16 rooms, R3 has 12 rooms and R4 has 12 rooms; the median is 14.',
    );
  });
  it('an even count with an odd one out: 16/16/16/12 has a median of 16', () => {
    const c = check(
      inputs({ prelimRoundCount: 4, roundRows: bpRows([64, 64, 64, 48]) }),
      'rooms_consistent',
    );
    expect(c.detail).toBe('R4 has 12 rooms; the other rounds have 16.');
  });
  it('na with no prelim rows', () => {
    expect(check(inputs(), 'rooms_consistent').status).toBe('na');
  });
});

describe('team_coverage', () => {
  const rows = bpRows([100, 100, 100]);
  const tab = tabFromRows(rows);
  it('pass when R1 has every tab team', () => {
    expect(check(inputs({ roundRows: rows, teamTab: tab }), 'team_coverage').status).toBe('pass');
  });
  it('warn when R1 has under 95% of tab teams', () => {
    const r = rows.filter((x) => !(x.round === 1 && Number(x.team.slice(1)) > 90));
    const c = check(inputs({ roundRows: r, teamTab: tab }), 'team_coverage');
    expect(c.status).toBe('warn');
    expect(c.detail).toBe('R1 has 90 teams; the team tab has 100.');
  });
  it('fail under 80%', () => {
    const r = rows.filter((x) => !(x.round === 1 && Number(x.team.slice(1)) > 70));
    expect(check(inputs({ roundRows: r, teamTab: tab }), 'team_coverage').status).toBe('fail');
  });
  it('swing teams in R1 do not cover for missing tab teams', () => {
    const r = rows.filter((x) => !(x.round === 1 && Number(x.team.slice(1)) > 90));
    const swings = names('Swing ', 12).map((team) => ({
      team,
      round: 1,
      points: 0,
      wins: null,
      position: 'CO',
    }));
    const c = check(inputs({ roundRows: [...r, ...swings], teamTab: tab }), 'team_coverage');
    expect(c.status).toBe('warn');
    expect(c.detail).toBe('R1 has 90 teams; the team tab has 100.');
  });
});

describe('partners', () => {
  const tab = names('T', 20).map((team) => ({ team, points: null, wins: null }));
  const two = Object.fromEntries(tab.map((t) => [t.team, 2]));
  it('pass when every team has the minimum; a 5-person WSDC squad is fine', () => {
    const c = check(
      inputs({
        format: 'World Schools',
        teamTab: tab,
        speakersByTeam: Object.fromEntries(tab.map((t) => [t.team, 5])),
      }),
      'partners',
    );
    expect(c.status).toBe('pass');
  });
  it('warn when 1-10% are short', () => {
    const c = check(inputs({ teamTab: tab, speakersByTeam: { ...two, T1: 1 } }), 'partners');
    expect(c.status).toBe('warn');
    expect(c.detail).toBe('1 of 20 teams has fewer than 2 speakers on record.');
    expect(keys(c)).toEqual(['speaker:']);
  });
  it('fail over 10%; Asian Parliamentary needs three', () => {
    expect(
      check(
        inputs({ format: 'Asian Parliamentary', teamTab: tab, speakersByTeam: two }),
        'partners',
      ).status,
    ).toBe('fail');
  });
  it('na with no team tab', () => {
    expect(check(inputs(), 'partners').status).toBe('na');
  });
});

describe('panels', () => {
  const rows = bpRows([40, 40, 40]);
  const full = {
    1: { chairs: 10, judges: 30 },
    2: { chairs: 10, judges: 30 },
    3: { chairs: 10, judges: 30 },
  };
  const base = { roundRows: rows, judgeParticipants: 40, roundResultJudges: 38 };
  it('pass when every round has a chair and a judge per room', () => {
    expect(check(inputs({ ...base, judgesByRound: full }), 'panels').status).toBe('pass');
  });
  it('fail under 90% of rooms, naming the round', () => {
    const c = check(
      inputs({ ...base, judgesByRound: { ...full, 2: { chairs: 6, judges: 20 } } }),
      'panels',
    );
    expect(c.status).toBe('fail');
    expect(c.detail).toBe('R2 has 6 chairs and 20 judges for 10 rooms.');
    expect(keys(c)).toEqual(['round:2']);
  });
  it('a round at 96% of rooms passes at full weight, naming the shortfall', () => {
    const r = bpRows([100, 100, 100]);
    const ok = { chairs: 25, judges: 60 };
    const c = check(
      inputs({
        ...base,
        roundRows: r,
        judgesByRound: { 1: ok, 2: { chairs: 24, judges: 60 }, 3: ok },
      }),
      'panels',
    );
    expect(c.status).toBe('pass');
    expect(c.detail).toBe('R2 has 24 chairs and 60 judges for 25 rooms, within 90% of rooms.');
    expect(c.pieces).toEqual([]);
  });
  it("only the owner's panels stored: panels is na", () => {
    const c = check(
      inputs({ ...base, roundResultJudges: 1, judgesByRound: { 1: { chairs: 1, judges: 1 } } }),
      'panels',
    );
    expect(c.status).toBe('na');
    expect(c.detail).toBe('Panels are stored for 1 of 40 judges, too few to check.');
  });
});

describe('points_add_up', () => {
  const rows = bpRows([24, 24, 24]);
  const tab = tabFromRows(rows);
  it('pass when BP tab points equal the round sums', () => {
    expect(check(inputs({ roundRows: rows, teamTab: tab }), 'points_add_up').status).toBe('pass');
  });
  it('BP with one team off warns (1 of 24 is under 5%) and suggests the tab and its rounds', () => {
    const off = tab.map((t) => (t.team === 'T1' ? { ...t, points: 7 } : t));
    const c = check(inputs({ roundRows: rows, teamTab: off }), 'points_add_up');
    expect(c.status).toBe('warn');
    expect(c.detail).toBe(
      '1 of 24 teams has tab points that differ from its round total (T1: 7 on the tab, 9 in the rounds).',
    );
    expect(keys(c)).toEqual(['team:', 'round:1', 'round:2', 'round:3']);
  });
  it('a team missing a round fails over 5% and suggests that round', () => {
    const r = rows.filter((x) => !(x.round === 3 && ['T1', 'T2'].includes(x.team)));
    const c = check(inputs({ roundRows: r, teamTab: tab }), 'points_add_up');
    expect(c.status).toBe('fail');
    expect(keys(c)).toEqual(['team:', 'round:3']);
  });
  it('two-team formats compare wins', () => {
    const r = [1, 2].flatMap((round) => [
      { team: 'A', round, points: 150, wins: 1, position: 'Gov' },
      { team: 'B', round, points: 140, wins: 0, position: 'Opp' },
    ]);
    const t = [
      { team: 'A', points: 999, wins: 2 },
      { team: 'B', points: 1, wins: 0 },
    ];
    expect(
      check(
        inputs({ format: 'Australs', prelimRoundCount: 2, roundRows: r, teamTab: t }),
        'points_add_up',
      ).status,
    ).toBe('pass');
  });
  it('na when nothing can be compared', () => {
    expect(check(inputs(), 'points_add_up').status).toBe('na');
  });
});
