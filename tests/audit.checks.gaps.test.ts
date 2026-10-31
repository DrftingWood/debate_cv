import { describe, expect, it } from 'vitest';
import { CHECKS_VERSION } from '@/lib/audit/checks';
import { CHECK_LABELS, CHECK_WEIGHTS } from '@/lib/audit/types';
import { PARSER, bpRows, check, inputs, keys, marked, piece, stage } from './fixtures/auditInputs';

// R12: data gaps the partial scrape can close. Motions and the speaker tab
// extend the existing checks (their suggested piece was already there); the
// break and the old parser are new in this file. A page the menu does not
// link is recorded withheld and answers na, never a failure.

const open = piece('break', 'open', 'Break: Open');
const final = stage('Grand Final', ['A', 'B'], 1);

describe('registry', () => {
  it('break_unstored has weight 3 and a label, and the version moved on', () => {
    expect(CHECK_WEIGHTS.break_unstored).toBe(3);
    expect(CHECK_LABELS.break_unstored).toBe('Break stored');
    expect(CHECKS_VERSION).toBe('2026-10-31.10');
  });
});

describe('break_unstored', () => {
  it('is na when no break page is linked', () => {
    const c = check(inputs({ outrounds: final }), 'break_unstored');
    expect(c.status).toBe('na');
    expect(c.pieces).toEqual([]);
  });

  it('is na when the tournament does not publish the break', () => {
    const held = [{ ...marked(open, 'withheld'), reason: 'not_published' }];
    expect(check(inputs({ pieces: held, outrounds: final }), 'break_unstored').status).toBe('na');
  });

  it('passes when the linked break has rows', () => {
    const c = check(
      inputs({ pieces: [open], outrounds: final, breakRows: [{ stage: 'Open', team: 'A' }] }),
      'break_unstored',
    );
    expect(c.status).toBe('pass');
  });

  it('warns when a linked break has no rows and outrounds were debated, suggesting that break', () => {
    const c = check(inputs({ pieces: [open], outrounds: final }), 'break_unstored');
    expect(c.status).toBe('warn');
    expect(c.detail).toBe('The Open break page is linked but no break rows are stored.');
    expect(keys(c)).toEqual(['break:open']);
  });

  it('names only the brackets that are missing', () => {
    const esl = piece('break', 'esl', 'Break: ESL');
    const c = check(
      inputs({
        pieces: [open, esl],
        outrounds: [...final, ...stage('ESL Grand Final', ['C', 'D'], 1)],
        breakRows: [{ stage: 'Open', team: 'A' }],
      }),
      'break_unstored',
    );
    expect(c.detail).toBe('The ESL break page is linked but no break rows are stored.');
    expect(keys(c)).toEqual(['break:esl']);
  });

  it('is na when nothing was debated: an unannounced break is not a gap', () => {
    expect(check(inputs({ pieces: [open] }), 'break_unstored').status).toBe('na');
  });

  it('ignores the adjudicator break', () => {
    const adj = piece('break', 'adjudicators', 'Break: Adjudicators');
    expect(check(inputs({ pieces: [adj], outrounds: final }), 'break_unstored').status).toBe('na');
  });
});

describe('break_unstored per bracket', () => {
  it('is na for an empty Novice page beside stored Open outrounds', () => {
    const novice = piece('break', 'novice', 'Break: Novice');
    const c = check(
      inputs({
        pieces: [piece('break', 'open', 'Break: Open'), novice],
        outrounds: final,
        breakRows: [{ stage: 'Open', team: 'A' }],
      }),
      'break_unstored',
    );
    expect(c.status).toBe('pass');
    const only = check(inputs({ pieces: [novice], outrounds: final }), 'break_unstored');
    expect(only.status).toBe('na');
    expect(only.pieces).toEqual([]);
  });
});

describe('motions (extended)', () => {
  const failedMotions = [marked(piece('motions', '', 'Motions'), 'failed')];

  it('warns when a linked motions page never loaded and the prelim count is unknown', () => {
    const c = check(inputs({ prelimRoundCount: null, pieces: failedMotions }), 'motions');
    expect(c.status).toBe('warn');
    expect(c.detail).toBe('A motions page is linked but no motion is on record.');
    expect(keys(c)).toEqual(['motions:']);
  });

  it('stays na for a motions page that loaded ok and is legitimately empty', () => {
    const ok = [piece('motions', '', 'Motions')];
    expect(check(inputs({ prelimRoundCount: null, pieces: ok }), 'motions').status).toBe('na');
  });

  it('stays na when no motions page is linked and the count is unknown', () => {
    expect(check(inputs({ prelimRoundCount: null }), 'motions').status).toBe('na');
  });

  it('stays na for a motions page the tournament does not publish', () => {
    const held = [
      { ...marked(piece('motions', '', 'Motions'), 'withheld'), reason: 'not_published' },
    ];
    const c = check(inputs({ prelimRoundCount: null, pieces: held }), 'motions');
    expect(c.status).toBe('na');
    expect(c.pieces).toEqual([]);
  });
});

describe('speaker_tab (extended)', () => {
  const team = { roundRows: bpRows([4]) };

  it('warns when a linked speaker tab never loaded though teams are stored', () => {
    const failed = [marked(piece('speaker', '', 'Speaker tab'), 'failed')];
    const c = check(inputs({ ...team, pieces: failed }), 'speaker_tab');
    expect(c.status).toBe('warn');
    expect(c.detail).toBe('The speaker tab is linked but no speakers are on record.');
    expect(keys(c)).toEqual(['speaker:']);
  });

  it('stays na for a speaker tab that loaded ok and holds nobody', () => {
    const ok = [piece('speaker', '', 'Speaker tab')];
    expect(check(inputs({ ...team, pieces: ok }), 'speaker_tab').status).toBe('na');
  });

  it('stays na with no speaker page, or with nothing else stored', () => {
    expect(check(inputs(team), 'speaker_tab').status).toBe('na');
    expect(
      check(inputs({ pieces: [piece('speaker', '', 'Speaker tab')] }), 'speaker_tab').status,
    ).toBe('na');
  });

  it('stays na for a speaker tab the tournament does not publish', () => {
    const held = [{ ...marked(piece('speaker', '', 'Speaker tab'), 'withheld') }];
    expect(check(inputs({ ...team, pieces: held }), 'speaker_tab').status).toBe('na');
  });
});

describe('parser_stale (extended)', () => {
  const recorded = [
    piece('team', '', 'Team tab'),
    piece('round', '1', 'R1'),
    marked(piece('speaker', '', 'Speaker tab'), 'withheld'),
  ];

  it('suggests every recorded page that can be read, so a Fix refreshes them all', () => {
    const c = check(inputs({ parserVersion: '20260101.0', pieces: recorded }), 'parser_stale');
    expect(c.status).toBe('warn');
    expect(keys(c)).toEqual(['team:', 'round:1']);
  });

  it('passes, with its own words, when the pages were refreshed under the current parser', () => {
    const c = check(
      inputs({ parserVersion: '20260101.0', pagesRefreshedUnder: PARSER, pieces: recorded }),
      'parser_stale',
    );
    expect(c.status).toBe('pass');
    expect(c.detail).toBe(
      'Pages refreshed under the current parser; format and unpublished pages update on the next full scrape.',
    );
    expect(c.pieces).toEqual([]);
  });

  it('warns when the refresh was under an older parser or never happened', () => {
    const old = inputs({ parserVersion: '20260101.0', pagesRefreshedUnder: '20260102.0' });
    expect(check(old, 'parser_stale').status).toBe('warn');
    expect(check(inputs({ parserVersion: null }), 'parser_stale').status).toBe('warn');
  });

  it('suggests nothing when the parser is current', () => {
    const c = check(inputs({ pieces: recorded }), 'parser_stale');
    expect(c.status).toBe('pass');
    expect(c.pieces).toEqual([]);
  });
});
