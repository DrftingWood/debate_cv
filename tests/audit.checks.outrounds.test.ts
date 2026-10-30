import { describe, expect, it } from 'vitest';
import { runChecks } from '@/lib/audit/checks';
import { check, inputs, keys, marked, names, PARSER, piece, stage } from './fixtures/auditInputs';

// Outround, tab and report checks. The prelim-round checks are in
// audit.checks.test.ts.

const openBreak = (n: number) => names('O', n).map((team) => ({ stage: 'Open', team }));
const gf = piece('round', '9', 'Grand Final');
const sf = piece('round', '8', 'Semifinals');
const breakOpen = piece('break', 'open', 'Break: Open');

/** A clean 8-team BP Open bracket: SF of 8 (4 won), GF of 4 (1 won). */
const cleanOpen = [
  ...stage('Semifinals', names('O', 8), 4),
  ...stage('Grand Final', names('O', 4), 1),
];

describe('champion', () => {
  it('a tournament that never broke: champion is na', () => {
    expect(check(inputs(), 'champion').status).toBe('na');
  });
  it('pass when the Open final has exactly one winner', () => {
    const c = check(inputs({ breakRows: openBreak(8), outrounds: cleanOpen }), 'champion');
    expect(c.status).toBe('pass');
    expect(c.detail).toBe('O1 won the Grand Final.');
  });
  it('fail with break rows but no outround results, suggesting the final piece', () => {
    const c = check(inputs({ breakRows: openBreak(8), pieces: [sf, gf, breakOpen] }), 'champion');
    expect(c.status).toBe('fail');
    expect(c.detail).toBe('8 teams broke, but no outround results are stored.');
    expect(keys(c)).toEqual(['round:9']);
  });
  it('falls back to the break piece when no final piece is recorded', () => {
    const c = check(inputs({ breakRows: openBreak(8), pieces: [breakOpen] }), 'champion');
    expect(keys(c)).toEqual(['break:open']);
    expect(c.pieces[0]!.url).toBe('https://wudc.calicotab.com/wudc/tab/break/open');
  });
  it('fail when the final has two winners', () => {
    const o = [...stage('Semifinals', names('O', 8), 4), ...stage('Grand Final', names('O', 4), 2)];
    const c = check(inputs({ breakRows: openBreak(8), outrounds: o, pieces: [gf] }), 'champion');
    expect(c.status).toBe('fail');
    expect(c.detail).toBe('The Grand Final has 2 winners; it should have one.');
    expect(keys(c)).toEqual(['round:9']);
  });
  it('an ESL final does not stand in for the Open champion', () => {
    const o = [
      ...stage('Semifinals', names('O', 8), 4),
      ...stage('ESL Grand Final', names('E', 4), 1),
    ];
    const c = check(inputs({ breakRows: openBreak(8), outrounds: o }), 'champion');
    expect(c.status).toBe('fail');
    expect(c.detail).toBe('The outround results have no Open final.');
  });
  it('the Open final is chosen over a category final', () => {
    const o = [...cleanOpen, ...stage('Novice Final', names('N', 4), 2)];
    expect(check(inputs({ outrounds: o }), 'champion').status).toBe('pass');
  });
});

// Owner ruling 7: with no Open bracket at all, the top category's final names
// the champion; with one, a category final never does.
describe('champion across brackets', () => {
  it("a Senior/Junior-only tab: the top bracket's final names the champion", () => {
    const o = [
      ...stage('Senior Semifinals', names('S', 8), 4),
      ...stage('Senior Grand Final', names('S', 4), 1),
      ...stage('Junior Grand Final', names('J', 4), 1),
    ];
    const c = check(inputs({ outrounds: o }), 'champion');
    expect(c.status).toBe('pass');
    expect(c.detail).toBe('S1 won the Senior Grand Final.');
  });
  it('a category-only tab whose top final has two winners fails', () => {
    const o = [
      ...stage('Varsity Semifinals', names('V', 8), 4),
      ...stage('Varsity Final', names('V', 4), 2),
      ...stage('Novice Final', names('N', 4), 1),
    ];
    expect(check(inputs({ outrounds: o }), 'champion').status).toBe('fail');
  });
  it('an Open break with only a category final still fails: Open exists', () => {
    const o = stage('ESL Grand Final', names('E', 4), 1);
    expect(check(inputs({ breakRows: openBreak(8), outrounds: o }), 'champion').status).toBe(
      'fail',
    );
  });
  it('the champion detail counts only the Open break', () => {
    const esl = names('E', 4).map((team) => ({ stage: 'ESL', team }));
    const c = check(inputs({ breakRows: [...openBreak(8), ...esl] }), 'champion');
    expect(c.detail).toBe('8 teams broke, but no outround results are stored.');
  });
  it('a Gold final counts as the main final when there is no plain one', () => {
    expect(
      check(inputs({ outrounds: stage('Gold Final', names('G', 4), 1) }), 'champion').status,
    ).toBe('pass');
  });
});

describe('outround_shape', () => {
  it('a QF with 16 teams where 8 won passes', () => {
    const o = [...stage('Quarterfinals', names('O', 16), 8), ...cleanOpen];
    const c = check(inputs({ outrounds: o }), 'outround_shape');
    expect(c.status).toBe('pass');
    expect(c.detail).toBe('All 3 outround stages have the expected teams and winners.');
  });
  it('a SF with 8 teams where 3 won fails, suggesting that stage', () => {
    const o = [...stage('Semifinals', names('O', 8), 3), ...stage('Grand Final', names('O', 4), 1)];
    const c = check(inputs({ outrounds: o, pieces: [sf, gf] }), 'outround_shape');
    expect(c.status).toBe('fail');
    expect(c.detail).toBe('The Semifinals has 8 teams and 3 winners; half should win.');
    expect(keys(c)).toEqual(['round:8']);
  });
  it('a stage with the wrong number of teams after the one before fails', () => {
    const o = [
      ...stage('Quarterfinals', names('O', 16), 8),
      ...stage('Grand Final', names('O', 4), 1),
    ];
    const c = check(inputs({ outrounds: o }), 'outround_shape');
    expect(c.status).toBe('fail');
    expect(c.detail).toBe('The Grand Final has 4 teams, but the Quarterfinals before it had 16.');
    expect(c.pieces).toEqual([]);
  });
  it('is checked per bracket: an ESL bracket does not follow the Open one', () => {
    const o = [...cleanOpen, ...stage('ESL Grand Final', names('E', 4), 1)];
    expect(check(inputs({ outrounds: o }), 'outround_shape').status).toBe('pass');
  });
  it('a partial round is not halved into the next', () => {
    const o = [
      ...stage('Partial Semifinals', names('O', 4), 2),
      ...stage('Grand Final', names('O', 4), 1),
    ];
    expect(check(inputs({ outrounds: o }), 'outround_shape').status).toBe('pass');
  });
  it('na with no outrounds', () => {
    expect(check(inputs(), 'outround_shape').status).toBe('na');
  });
});

describe('break_matches', () => {
  it('pass when the Open break equals the Open outround teams', () => {
    expect(
      check(inputs({ breakRows: openBreak(8), outrounds: cleanOpen }), 'break_matches').status,
    ).toBe('pass');
  });
  it('warn when they differ, suggesting the Open break', () => {
    const c = check(
      inputs({ breakRows: openBreak(16), outrounds: cleanOpen, pieces: [breakOpen] }),
      'break_matches',
    );
    expect(c.status).toBe('warn');
    expect(c.detail).toBe('The Open break lists 16 teams; the Open outrounds have 8.');
    expect(keys(c)).toEqual(['break:open']);
  });
  it('na without an Open break', () => {
    expect(check(inputs({ outrounds: cleanOpen }), 'break_matches').status).toBe('na');
  });
});

describe('speaker_tab', () => {
  const s = (n: number) =>
    check(inputs({ speakerParticipants: 100, speakersWithScores: n }), 'speaker_tab');
  it('thresholds 80% and 50%', () => {
    expect(s(80).status).toBe('pass');
    expect(s(79).status).toBe('warn');
    expect(s(50).status).toBe('warn');
    expect(s(49).status).toBe('fail');
    expect(s(49).detail).toBe('Speaker scores are on record for 49 of 100 speakers.');
    expect(keys(s(49))).toEqual(['speaker:']);
  });
  it('na with no speakers', () => expect(check(inputs(), 'speaker_tab').status).toBe('na'));
});

describe('motions', () => {
  it('pass, warn when a round has none, na when withheld', () => {
    expect(check(inputs({ motionRounds: [1, 2, 3] }), 'motions').status).toBe('pass');
    const w = check(inputs({ motionRounds: [1] }), 'motions');
    expect(w.status).toBe('warn');
    expect(w.detail).toBe('R2 and R3 have no motion on record.');
    expect(keys(w)).toEqual(['motions:']);
    const withheld = [marked(piece('motions', '', 'Motions'), 'withheld')];
    expect(check(inputs({ pieces: withheld }), 'motions').status).toBe('na');
  });
});

describe('scrape_incomplete and parser_stale', () => {
  it('fail on failed pieces, suggesting them', () => {
    const p = [
      marked(piece('round', '3', 'R3'), 'failed'),
      marked(piece('speaker', '', 'Speaker tab'), 'failed'),
      gf,
    ];
    const c = check(inputs({ pieces: p }), 'scrape_incomplete');
    expect(c.status).toBe('fail');
    expect(c.detail).toBe('2 pages failed to load: R3 and Speaker tab.');
    expect(keys(c)).toEqual(['round:3', 'speaker:']);
    expect(check(inputs({ pieces: [gf] }), 'scrape_incomplete').status).toBe('pass');
  });
  it('warn on an older or missing parser version', () => {
    expect(check(inputs(), 'parser_stale').status).toBe('pass');
    expect(check(inputs({ parserVersion: '20260101.0' }), 'parser_stale').status).toBe('warn');
    expect(check(inputs({ parserVersion: null }), 'parser_stale').status).toBe('warn');
  });
});

describe('user_reports', () => {
  const pieces = [
    sf,
    gf,
    breakOpen,
    piece('break', 'esl', 'Break: Esl'),
    piece('break', 'adjudicators', 'Break: Adjudicators'),
  ];
  it('pass with no reports', () => {
    expect(check(inputs(), 'user_reports').status).toBe('pass');
  });
  it('wrong_outround maps to the outround and break pieces', () => {
    const c = check(
      inputs({
        pieces,
        openReports: [{ categories: ['wrong_outround'] }, { categories: ['wrong_identity'] }],
      }),
      'user_reports',
    );
    expect(c.status).toBe('warn');
    expect(c.detail).toBe('2 open user reports.');
    expect(keys(c)).toEqual(['round:8', 'round:9', 'break:open', 'break:esl']);
  });
  it('wrong_teammate and wrong_team_result map to tabs and prelim rounds, deduplicated', () => {
    const c = check(
      inputs({
        prelimRoundCount: 2,
        openReports: [{ categories: ['wrong_teammate', 'wrong_team_result'] }],
      }),
      'user_reports',
    );
    expect(c.detail).toBe('1 open user report.');
    expect(keys(c)).toEqual(['speaker:', 'team:', 'round:1', 'round:2']);
  });
  it('results are in order with user reports last', () => {
    expect(runChecks(inputs(), PARSER).at(-1)!.code).toBe('user_reports');
  });
});
