import { describe, expect, it } from 'vitest';
import {
  CHECK_WEIGHTS,
  CHECK_LABELS,
  publicPieceUrl,
  type CheckCode,
  type CheckResult,
  type CheckStatus,
} from '@/lib/audit/types';
import { band, databaseScore, scoreTournament } from '@/lib/audit/score';

const codes = Object.keys(CHECK_WEIGHTS) as Array<keyof typeof CHECK_WEIGHTS>;

function all(status: CheckStatus, over: Partial<Record<CheckCode, CheckStatus>> = {}) {
  return codes.map((code): CheckResult => ({
    code,
    status: over[code] ?? status,
    detail: '',
    pieces: [],
  }));
}

describe('scoreTournament', () => {
  it('spec weights sum to 116', () => {
    expect(codes.reduce((a, c) => a + CHECK_WEIGHTS[c], 0)).toBe(116);
  });
  it('all pass is 100', () => expect(scoreTournament(all('pass'), 0)).toBe(100));
  it('a champion fail costs its weight', () =>
    expect(scoreTournament(all('pass', { champion: 'fail' }), 0)).toBe(
      Math.round((100 * (116 - 15)) / 116),
    ));
  it('a warn earns half', () =>
    expect(scoreTournament(all('pass', { champion: 'warn' }), 0)).toBe(
      Math.round((100 * (116 - 7.5)) / 116),
    ));
  it('all na is 100', () => expect(scoreTournament(all('na'), 0)).toBe(100));
  it('open reports subtract 10 each, capped at 30', () => {
    expect(scoreTournament(all('pass'), 2)).toBe(80);
    expect(scoreTournament(all('pass'), 4)).toBe(70);
  });
  it('floors at 0', () => expect(scoreTournament(all('fail'), 4)).toBe(0));
});

describe('band', () => {
  it('cuts at 90 and 70', () => {
    expect(band(90)).toBe('good');
    expect(band(89)).toBe('check');
    expect(band(70)).toBe('check');
    expect(band(69)).toBe('rescrape');
  });
});

describe('databaseScore', () => {
  it('weights by 1 + usersAffected', () => {
    expect(
      databaseScore([
        { score: 50, usersAffected: 3 },
        { score: 100, usersAffected: 0 },
      ]),
    ).toEqual({ weighted: 60, unweighted: 75, n: 2 });
  });
  it('is null when empty', () =>
    expect(databaseScore([])).toEqual({ weighted: null, unweighted: null, n: 0 }));
});

describe('publicPieceUrl', () => {
  it('never returns a private key', () => {
    const out = publicPieceUrl('https://x.calicotab.com/t1/privateurls/SECRETKEY/');
    expect(out).toBe('https://x.calicotab.com/t1/');
    expect(out).not.toContain('SECRETKEY');
  });
  it('leaves a public round URL unchanged', () => {
    const u = 'https://x.calicotab.com/t1/results/round/3/';
    expect(publicPieceUrl(u)).toBe(u);
  });
  it('returns null for garbage', () => {
    expect(publicPieceUrl('not a url')).toBeNull();
    expect(publicPieceUrl('javascript:alert(1)')).toBeNull();
  });
  it('labels every code', () => expect(Object.keys(CHECK_LABELS)).toHaveLength(15));
});
