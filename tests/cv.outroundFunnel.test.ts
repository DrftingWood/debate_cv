import { describe, expect, test } from 'vitest';
import { bracketOf, outroundFunnel } from '@/lib/cv/outroundFunnel';
import type { TournamentFact } from '@/lib/cv/statsFacts';

let id = 0;
const t = (o: Partial<TournamentFact>): TournamentFact => ({
  tournamentId: String(++id),
  name: `T${id}`,
  year: 2024,
  format: 'British Parliamentary',
  partners: [],
  partnerGap: null,
  proAm: null,
  broke: false,
  breakRank: null,
  deepestOutround: null,
  won: null,
  speakerRank: null,
  ...o,
});
const rung = (f: ReturnType<typeof outroundFunnel>, key: string) =>
  f!.rungs.find((r) => r.key === key)!;

describe('bracketOf', () => {
  test('bare and "Open" labels are the open bracket; a missing label has no category either', () => {
    expect(bracketOf('Grand Final')).toBe('open');
    expect(bracketOf('Open Partial Double Octas')).toBe('open');
    expect(bracketOf(null)).toBe('open');
  });

  test('ESL, Novice and other named brackets are categories', () => {
    expect(bracketOf('ESL Finals')).toBe('category');
    expect(bracketOf('Novice Semifinals')).toBe('category');
    expect(bracketOf('Junior Grand Final')).toBe('category');
  });

  test('plate, consolation and lower brackets are consolation', () => {
    for (const label of ['Plate Final', 'Consolation Final', 'Lower Bracket Final']) {
      expect(bracketOf(label)).toBe('consolation');
    }
  });

  test('gold, silver and bronze finals are real (category) brackets, not consolation (owner, C9)', () => {
    for (const label of ['Gold Final', 'Silver Final', 'Bronze Finals']) {
      expect(bracketOf(label)).toBe('category');
    }
  });
});

describe('outroundFunnel', () => {
  test('empty input has nothing to show', () => {
    expect(outroundFunnel([])).toBeNull();
  });

  test('cumulative rungs: each counts tournaments that went at least that deep', () => {
    const f = outroundFunnel([
      t({}),
      t({ broke: true, deepestOutround: 'Octofinals' }),
      t({ broke: true, deepestOutround: 'Quarterfinals' }),
      t({ broke: true, deepestOutround: 'Semifinals' }),
      t({ broke: true, deepestOutround: 'Grand Final', won: false }),
      t({ broke: true, deepestOutround: 'Grand Final', won: true }),
    ]);
    expect(f!.rungs.map((r) => [r.key, r.count])).toEqual([
      ['spoken', 6],
      ['broke', 5],
      ['quarterfinal', 4],
      ['semifinal', 3],
      ['final', 2],
      ['won', 1],
    ]);
    expect(rung(f, 'won')).toMatchObject({ from: 2, of: 1 });
    expect(rung(f, 'spoken').from).toBeNull();
  });

  test('went out at each stage: the deepest stage is that one', () => {
    const f = outroundFunnel([
      t({}),
      t({ broke: true, deepestOutround: 'Octofinals' }),
      t({ broke: true, deepestOutround: 'Quarterfinals' }),
      t({ broke: true, deepestOutround: 'Partial Quarterfinals' }),
      t({ broke: true, deepestOutround: 'Semifinals' }),
      t({ broke: true, deepestOutround: 'Grand Final', won: false }),
      t({ broke: true, deepestOutround: 'Grand Final', won: null }),
      t({ broke: true, deepestOutround: 'Grand Final', won: true }),
    ]);
    expect(f!.rungs.map((r) => [r.key, r.wentOut])).toEqual([
      ['spoken', 1],
      ['broke', 1],
      ['quarterfinal', 2],
      ['semifinal', 1],
      ['final', 1],
      ['won', null],
    ]);
    // Every tournament ends somewhere: out at a rung, champion, or a final with no result.
    const out = f!.rungs.reduce((s, r) => s + (r.wentOut ?? 0), 0);
    expect(out + rung(f, 'won').count + f!.finalsUndecided + f!.unknownDepth).toBe(8);
  });

  test('conversion only where every team at the rung above had to play for this one', () => {
    const f = outroundFunnel([
      t({}),
      t({ broke: true, deepestOutround: 'Quarterfinals' }),
      t({ broke: true, deepestOutround: 'Semifinals' }),
      t({ broke: true, deepestOutround: 'Grand Final', won: true }),
    ]);
    expect(rung(f, 'broke')).toMatchObject({ from: 4, of: 3 });
    // Bracket size decides these: a break that starts at the semis never played a quarterfinal,
    // and a top seed can take a bye through a partial semifinal into the final.
    for (const key of ['quarterfinal', 'semifinal', 'final']) {
      expect(rung(f, key)).toMatchObject({ from: null, of: null });
    }
    expect(rung(f, 'won')).toMatchObject({ from: 1, of: 1 });
  });

  test('a partial round is that rung run with byes: it counts on the rung, not the one above', () => {
    const f = outroundFunnel([
      t({ broke: true, deepestOutround: 'Octofinals' }),
      t({ broke: true, deepestOutround: 'Partial Double Octofinals' }),
      t({ broke: true, deepestOutround: 'Double Octofinals' }),
      // "Pre-Semifinals" = Partial Quarterfinals: the quarterfinal round, feeding the semis.
      t({ broke: true, deepestOutround: 'Partial Quarterfinals' }),
      t({ broke: true, deepestOutround: 'Pre-Semi Finals' }),
      // "Pre-Final" = Partial Semifinals.
      t({ broke: true, deepestOutround: 'Partial Semifinals' }),
    ]);
    expect(rung(f, 'broke').count).toBe(6);
    expect(rung(f, 'quarterfinal').count).toBe(3);
    expect(rung(f, 'semifinal').count).toBe(1);
    expect(rung(f, 'final').count).toBe(0);
    expect(f!.unknownDepth).toBe(0);
  });

  test('category brackets break, but their finals and titles sit apart from the open rungs', () => {
    const f = outroundFunnel([
      t({ broke: true, deepestOutround: 'ESL Final', won: false }),
      t({ broke: true, deepestOutround: 'ESL Finals', won: true }),
      t({ broke: true, deepestOutround: 'Novice Semifinals' }),
      t({ broke: true, deepestOutround: 'Final', won: false }),
    ]);
    expect(rung(f, 'broke').count).toBe(4);
    expect(rung(f, 'semifinal').count).toBe(1);
    expect(rung(f, 'final').count).toBe(1);
    expect(rung(f, 'won').count).toBe(0);
    expect(f!.category).toEqual({ breaks: 3, finals: 2, titles: 1, brackets: ['ESL', 'Novice'] });
  });

  test('consolation brackets are never a break, a final or a title of the tournament', () => {
    const f = outroundFunnel([
      t({ broke: true, deepestOutround: 'Plate Final', won: false }),
      t({ broke: true, deepestOutround: 'Consolation Final' }),
      t({ broke: true, deepestOutround: 'Lower Bracket Final' }),
    ]);
    expect(rung(f, 'broke').count).toBe(0);
    expect(rung(f, 'final').count).toBe(0);
    expect(rung(f, 'won').count).toBe(0);
    expect(f!.category.breaks).toBe(0);
    expect(f!.consolation).toEqual({
      tournaments: 3,
      brackets: ['Consolation', 'Lower Bracket', 'Plate'],
    });
  });

  test('gold, silver and bronze finals count as breaks and final-level appearances; a win is a category title', () => {
    const f = outroundFunnel([
      t({ broke: true, deepestOutround: 'Gold Final', won: true }),
      t({ broke: true, deepestOutround: 'Silver Final', won: false }),
      t({ broke: true, deepestOutround: 'Bronze Final' }),
    ]);
    expect(rung(f, 'broke').count).toBe(3);
    expect(f!.category).toMatchObject({ breaks: 3, finals: 3, titles: 1 });
    expect(f!.category.brackets).toEqual(['Bronze', 'Gold', 'Silver']);
    expect(f!.consolation.tournaments).toBe(0);
  });

  test('gold, silver and bronze finals reach the funnel final rung (and the rungs below); plate does not; ESL does not', () => {
    const f = outroundFunnel([
      t({ broke: true, deepestOutround: 'Gold Final', won: false }),
      t({ broke: true, deepestOutround: 'Silver Final' }),
      t({ broke: true, deepestOutround: 'Bronze Final', won: false }),
      t({ broke: true, deepestOutround: 'Plate Final', won: false }),
      t({ broke: true, deepestOutround: 'ESL Final', won: false }),
    ]);
    expect(rung(f, 'final').count).toBe(3);
    expect(rung(f, 'semifinal').count).toBe(3);
    expect(rung(f, 'quarterfinal').count).toBe(3);
    // Tier results are not the open final's: out of the lost/decided conversions.
    expect(rung(f, 'final').wentOut).toBe(0);
    expect(f!.finalsUndecided).toBe(0);
    expect(f!.consolation.tournaments).toBe(1);
  });

  test('a Silver Semifinal is not a final', () => {
    const f = outroundFunnel([t({ broke: true, deepestOutround: 'Silver Semifinals' })]);
    expect(rung(f, 'final').count).toBe(0);
  });

  test('a Final and a Grand Final land on the same rung', () => {
    const f = outroundFunnel([
      t({ broke: true, deepestOutround: 'Final', won: true }),
      t({ broke: true, deepestOutround: 'Grand Final', won: true }),
    ]);
    expect(rung(f, 'final').count).toBe(2);
    expect(rung(f, 'won').count).toBe(2);
  });

  test('a small break straight to semifinals still counts on the quarterfinal rung', () => {
    const f = outroundFunnel([t({ broke: true, deepestOutround: 'Semifinals' })]);
    expect(rung(f, 'quarterfinal').count).toBe(1);
  });

  test('broke with no stage (or an unreadable one) counts as a break of unknown depth', () => {
    const f = outroundFunnel([
      t({ broke: true, deepestOutround: null }),
      t({ broke: true, deepestOutround: 'Round 10' }),
      t({ broke: true, deepestOutround: 'Quarterfinals' }),
      t({ broke: true, deepestOutround: 'Octofinals' }),
    ]);
    expect(rung(f, 'broke').count).toBe(4);
    expect(f!.unknownDepth).toBe(2);
    expect(rung(f, 'quarterfinal').count).toBe(1);
    expect(rung(f, 'broke').wentOut).toBe(1);
  });

  test('won without a final label: a title proves the final (and the break)', () => {
    const f = outroundFunnel([
      t({ broke: false, deepestOutround: null, won: true }),
      t({ broke: true, deepestOutround: 'Semifinals', won: true }),
    ]);
    expect(rung(f, 'broke').count).toBe(2);
    expect(rung(f, 'final').count).toBe(2);
    expect(rung(f, 'won').count).toBe(2);
    expect(f!.unknownDepth).toBe(0);
  });

  test('won is only true === true; finals with no recorded result leave the conversion', () => {
    const f = outroundFunnel([
      t({ broke: true, deepestOutround: 'Grand Final', won: null }),
      t({ broke: true, deepestOutround: 'Grand Final', won: false }),
      t({ broke: true, deepestOutround: 'Grand Final', won: true }),
    ]);
    expect(rung(f, 'won')).toMatchObject({ count: 1, from: 2, of: 1 });
    expect(f!.finalsUndecided).toBe(1);
  });

  test('never broke: the funnel still shows the tournaments spoken', () => {
    const f = outroundFunnel([t({}), t({})]);
    expect(rung(f, 'spoken').count).toBe(2);
    expect(rung(f, 'broke')).toMatchObject({ count: 0, from: 2, of: 0 });
  });
});
