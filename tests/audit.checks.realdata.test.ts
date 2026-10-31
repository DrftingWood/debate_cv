import { describe, expect, it } from 'vitest';
import type { AuditInputs } from '@/lib/audit/checks';
import { bpRows, check, inputs, keys, names } from './fixtures/auditInputs';

// Shapes found by auditing six tournaments that scraped properly
// (.superpowers/sdd/2026-10-31-data-accuracy/real-data-check.md). Each was a
// false alarm: the owner's rule is that a correctly scraped tab is not
// highlighted. Each test also keeps the real problem next to it flagged.

/** Two-team rows: round i has the teams named in `rounds[i]`. */
function apRows(rounds: string[][]): AuditInputs['roundRows'] {
  return rounds.flatMap((teams, i) =>
    teams.map((team, t) => ({
      team,
      round: i + 1,
      points: null,
      wins: t % 2 === 0 ? 1 : 0,
      position: t % 2 === 0 ? 'Gov' : 'Opp',
    })),
  );
}

const without = (all: string[], gone: string[]) => all.filter((t) => !gone.includes(t));

const fifty = names('T', 50);

describe('rooms_consistent: teams that withdrew', () => {
  it('passes a last round one room short because two teams dropped out (CUPD R5)', () => {
    const r5 = without(fifty, ['T49', 'T50']);
    const c = check(
      inputs({
        format: 'Asian Parliamentary',
        prelimRoundCount: 5,
        roundRows: apRows([fifty, fifty, fifty, fifty, r5]),
      }),
      'rooms_consistent',
    );
    expect(c.status).toBe('pass');
  });
  it('passes two short rounds after the same teams left after R3 (Monash R4+R5)', () => {
    const forty = names('T', 40);
    const late = without(forty, ['T39', 'T40']);
    const c = check(
      inputs({
        format: 'Australs',
        prelimRoundCount: 5,
        roundRows: apRows([forty, forty, forty, late, late]),
      }),
      'rooms_consistent',
    );
    expect(c.status).toBe('pass');
  });
  it('passes when three teams left and a swing came in for the last round (NLSD R5)', () => {
    const forty = names('T', 40);
    const r5 = [...without(forty, ['T38', 'T39', 'T40']), 'Swing 1'];
    const c = check(
      inputs({
        format: 'Asian Parliamentary',
        prelimRoundCount: 5,
        roundRows: apRows([forty, forty, forty, forty, r5]),
      }),
      'rooms_consistent',
    );
    expect(c.status).toBe('pass');
  });
});

describe('rooms_consistent: short rounds withdrawals do not explain', () => {
  it('still warns when the missing teams come back in a later round (a lost room)', () => {
    const r4 = without(fifty, ['T49', 'T50']);
    const c = check(
      inputs({
        format: 'Asian Parliamentary',
        prelimRoundCount: 5,
        roundRows: apRows([fifty, fifty, fifty, r4, fifty]),
      }),
      'rooms_consistent',
    );
    expect(c.status).toBe('warn');
    expect(keys(c)).toEqual(['round:4']);
  });
  it('still warns when the withdrawals explain only part of a short round', () => {
    // T50 withdrew after R4, which leaves 49 teams: still 25 rooms. R5 is a
    // room short because T49 also sat it out, and T49 is back in R6.
    const r5 = without(fifty, ['T49', 'T50']);
    const r6 = without(fifty, ['T50']);
    const c = check(
      inputs({
        format: 'Asian Parliamentary',
        prelimRoundCount: 6,
        roundRows: apRows([fifty, fifty, fifty, fifty, r5, r6]),
      }),
      'rooms_consistent',
    );
    expect(c.status).toBe('warn');
    expect(keys(c)).toEqual(['round:5']);
  });
  it('a last round several rooms short still fails: likelier a cut-short page', () => {
    const r5 = names('T', 40);
    const c = check(
      inputs({
        format: 'Asian Parliamentary',
        prelimRoundCount: 5,
        roundRows: apRows([fifty, fifty, fifty, fifty, r5]),
      }),
      'rooms_consistent',
    );
    expect(c.status).toBe('fail');
  });
});

describe('swing teams on the team tab', () => {
  const real = names('T', 40);
  const swings = ['Swing 1', 'Swing 2', 'swing team'];
  const tab = [...real, ...swings].map((team) => ({ team, points: null, wins: null }));
  const three = Object.fromEntries(real.map((t) => [t, 3]));
  it('team_coverage counts only real teams (NLSD: 40 in R1, 43 on the tab)', () => {
    const c = check(
      inputs({
        format: 'Asian Parliamentary',
        prelimRoundCount: 1,
        roundRows: apRows([real]),
        teamTab: tab,
      }),
      'team_coverage',
    );
    expect(c.status).toBe('pass');
    expect(c.detail).toBe('R1 has 40 teams; the team tab has 40.');
  });
  it('partners leaves swings out: their "Speaker N" stand-ins are not stored', () => {
    const c = check(
      inputs({ format: 'Asian Parliamentary', teamTab: tab, speakersByTeam: three }),
      'partners',
    );
    expect(c.status).toBe('pass');
    expect(c.detail).toBe('All 40 teams have at least 3 speakers on record.');
  });
  it('a team merely starting with the word is not a swing ("Swingers United" counts)', () => {
    const c = check(
      inputs({
        format: 'Asian Parliamentary',
        teamTab: [...tab, { team: 'Swingers United', points: null, wins: null }],
        speakersByTeam: three,
      }),
      'partners',
    );
    expect(c.status).toBe('warn');
  });
});

describe('partners: redacted speakers', () => {
  const tab = names('T', 20).map((team) => ({ team, points: null, wins: null }));
  const three = Object.fromEntries(tab.map((t) => [t.team, 3]));
  const known = Object.fromEntries(tab.map((t) => [t.team, 0]));
  it('a team with a redacted speaker is not short (Monash UTS 1, NLSD Pineapple)', () => {
    const c = check(
      inputs({
        format: 'Australs',
        teamTab: tab,
        speakersByTeam: { ...three, T1: 2 },
        redactedByTeam: { ...known, T1: 1 },
      }),
      'partners',
    );
    expect(c.status).toBe('pass');
  });
  it('with the count known, a team short even with its redacted speakers still warns', () => {
    const c = check(
      inputs({
        format: 'Australs',
        teamTab: tab,
        speakersByTeam: { ...three, T1: 1 },
        redactedByTeam: { ...known, T1: 1 },
      }),
      'partners',
    );
    expect(c.status).toBe('warn');
  });
  it('with the count never recorded, only a team with no speakers at all is flagged', () => {
    const one = check(
      inputs({ format: 'Australs', teamTab: tab, speakersByTeam: { ...three, T1: 2 } }),
      'partners',
    );
    expect(one.status).toBe('pass');
    const none = check(
      inputs({ format: 'Australs', teamTab: tab, speakersByTeam: { ...three, T1: 0 } }),
      'partners',
    );
    expect(none.status).toBe('warn');
    expect(none.detail).toBe('1 of 20 teams has fewer than 3 speakers on record.');
  });
});

// The BP shape: IITB R5, 92 teams in R1-R4 and 88 in R5.
describe('rooms_consistent: BP withdrawal', () => {
  it('passes 23/23/23/23/22 rooms when four teams played R1-R4 only', () => {
    const rows = bpRows([92, 92, 92, 92, 88]);
    expect(check(inputs({ prelimRoundCount: 5, roundRows: rows }), 'rooms_consistent').status).toBe(
      'pass',
    );
  });
});
