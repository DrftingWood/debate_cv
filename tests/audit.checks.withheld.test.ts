import { describe, expect, it } from 'vitest';
import { runChecks } from '@/lib/audit/checks';
import {
  bpRows,
  check,
  inputs,
  keys,
  marked,
  names,
  PARSER,
  piece,
  stage,
  tabFromRows,
} from './fixtures/auditInputs';

// A page the tournament refuses (an unreleased Tabbycat tab answers 404) is
// recorded as 'withheld'. Each check that rests on such a page answers 'na'
// instead of marking the tournament down, and no withheld page is ever
// suggested for a re-scrape.

const teamTab = marked(piece('team', '', 'Team tab'), 'withheld');
const speakerTab = marked(piece('speaker', '', 'Speaker tab'), 'withheld');
const r3 = marked(piece('round', '3', 'R3'), 'withheld');
const r1 = marked(piece('round', '1', 'R1'), 'withheld');
const gfHeld = marked(piece('round', '9', 'Grand Final'), 'withheld');
const sfHeld = marked(piece('round', '8', 'Semifinals'), 'withheld');
const openBreak = (n: number) => names('O', n).map((team) => ({ stage: 'Open', team }));

describe('withheld team tab', () => {
  it('team_coverage is na, not a fail, and suggests nothing', () => {
    const c = check(inputs({ roundRows: bpRows([8, 8, 8]), pieces: [teamTab] }), 'team_coverage');
    expect(c.status).toBe('na');
    expect(c.detail).toBe('The tournament withholds its team tab.');
    expect(c.pieces).toEqual([]);
  });
  it('no team tab and nothing withheld still fails team_coverage', () => {
    const c = check(inputs({ roundRows: bpRows([8, 8, 8]) }), 'team_coverage');
    expect(c.status).toBe('fail');
  });
  it('points_add_up names the withheld team tab', () => {
    const c = check(inputs({ roundRows: bpRows([8, 8, 8]), pieces: [teamTab] }), 'points_add_up');
    expect(c.status).toBe('na');
    expect(c.detail).toBe('The tournament withholds its team tab.');
  });
  it('partners names the withheld team tab', () => {
    const c = check(inputs({ pieces: [teamTab] }), 'partners');
    expect(c.status).toBe('na');
    expect(c.detail).toBe('The tournament withholds its team tab.');
  });
});

describe('withheld speaker tab', () => {
  it('speaker_tab is na when the scores are missing because the tab is withheld', () => {
    const c = check(
      inputs({ speakerParticipants: 40, speakersWithScores: 0, pieces: [speakerTab] }),
      'speaker_tab',
    );
    expect(c.status).toBe('na');
    expect(c.detail).toBe('The tournament withholds its speaker tab.');
    expect(c.pieces).toEqual([]);
  });
  it('a full set of scores stored before the tab was pulled still passes', () => {
    const c = check(
      inputs({ speakerParticipants: 40, speakersWithScores: 40, pieces: [speakerTab] }),
      'speaker_tab',
    );
    expect(c.status).toBe('pass');
  });
});

describe('withheld prelim rounds', () => {
  it('rounds_complete does not expect a withheld round', () => {
    const rows = bpRows([8, 8]);
    const c = check(inputs({ roundRows: rows, pieces: [r3] }), 'rounds_complete');
    expect(c.status).toBe('pass');
    expect(c.detail).toBe('All 2 prelim rounds have results; the tournament withholds R3.');
  });
  it('rounds_complete still fails a round that is missing and not withheld', () => {
    const rows = bpRows([8, 8]).filter((r) => r.round !== 2);
    const c = check(inputs({ roundRows: rows, pieces: [r3] }), 'rounds_complete');
    expect(c.status).toBe('fail');
    expect(keys(c)).toEqual(['round:2']);
  });
  it('team_coverage is na when R1 is withheld and has no rows', () => {
    const rows = bpRows([8, 8, 8]).filter((r) => r.round !== 1);
    const c = check(
      inputs({ roundRows: rows, teamTab: tabFromRows(rows), pieces: [r1] }),
      'team_coverage',
    );
    expect(c.status).toBe('na');
    expect(c.detail).toBe('The tournament withholds its R1 results.');
  });
  it('points_add_up skips teams whose total includes a withheld round', () => {
    const all = bpRows([8, 8, 8]);
    const shown = all.filter((r) => r.round !== 3);
    const c = check(
      inputs({ roundRows: shown, teamTab: tabFromRows(all), pieces: [r3] }),
      'points_add_up',
    );
    expect(c.status).toBe('na');
    expect(c.detail).toBe(
      "The tournament withholds the results of R3, so no team's total can be checked.",
    );
    expect(c.pieces).toEqual([]);
  });
});

describe('points_add_up with no rows for a team', () => {
  it('a tab team with no round rows at all is not a mismatch', () => {
    const rows = bpRows([8, 8, 8]);
    const tab = [...tabFromRows(rows), { team: 'Renamed', points: 9, wins: null }];
    const c = check(inputs({ roundRows: rows, teamTab: tab }), 'points_add_up');
    expect(c.status).toBe('pass');
    expect(c.detail).toBe("All 8 teams' tab points equal their round totals.");
  });
});

describe('withheld outrounds and break', () => {
  it('champion is na when outround pages are withheld and none are stored', () => {
    const c = check(inputs({ breakRows: openBreak(8), pieces: [sfHeld, gfHeld] }), 'champion');
    expect(c.status).toBe('na');
    expect(c.detail).toBe('The tournament withholds its outround results.');
    expect(c.pieces).toEqual([]);
  });
  it('champion is na when the main final page is withheld', () => {
    const o = stage('Semifinals', names('O', 8), 4);
    const c = check(
      inputs({ breakRows: openBreak(8), outrounds: o, pieces: [gfHeld] }),
      'champion',
    );
    expect(c.status).toBe('na');
  });
  it('outround_shape leaves out a bracket with a withheld stage', () => {
    // The semifinal is stored, but the final page is withheld: halving can't be judged.
    const o = stage('Semifinals', names('O', 8), 3);
    const c = check(inputs({ outrounds: o, pieces: [gfHeld] }), 'outround_shape');
    expect(c.status).toBe('na');
    expect(c.detail).toBe('The tournament withholds some of its outround results.');
  });
  it('break_matches is na when an Open outround is withheld', () => {
    const o = stage('Grand Final', names('O', 4), 1);
    const c = check(
      inputs({ breakRows: openBreak(8), outrounds: o, pieces: [sfHeld] }),
      'break_matches',
    );
    expect(c.status).toBe('na');
    expect(c.pieces).toEqual([]);
  });
  it('break_matches is na when the Open break page is withheld', () => {
    const held = marked(piece('break', 'open', 'Break: Open'), 'withheld');
    const o = stage('Grand Final', names('O', 4), 1);
    const c = check(inputs({ outrounds: o, pieces: [held] }), 'break_matches');
    expect(c.status).toBe('na');
    expect(c.detail).toBe('The tournament withholds part of its Open break or outrounds.');
  });
});

describe('suggestions', () => {
  it('no check suggests a withheld piece', () => {
    const rows = bpRows([8, 8, 8]).filter((r) => r.round !== 3);
    const results = runChecks(
      inputs({
        roundRows: rows,
        speakerParticipants: 40,
        speakersWithScores: 30,
        pieces: [teamTab, speakerTab, r3, gfHeld],
        openReports: [{ categories: ['wrong_teammate', 'wrong_team_result', 'wrong_outround'] }],
      }),
      PARSER,
    );
    const suggested = results.flatMap((c) => c.pieces.map((p) => `${p.kind}:${p.key}`));
    for (const k of ['team:', 'speaker:', 'round:3', 'round:9']) expect(suggested).not.toContain(k);
  });
});
