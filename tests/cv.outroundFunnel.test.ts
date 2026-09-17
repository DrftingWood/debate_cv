import { describe, expect, test } from 'vitest';
import { outroundFunnel } from '@/lib/cv/outroundFunnel';
import type { TournamentFact } from '@/lib/cv/statsFacts';

let id = 0;
const t = (o: Partial<TournamentFact>): TournamentFact => ({
  tournamentId: String(++id), name: `T${id}`, year: 2024, format: 'British Parliamentary',
  partners: [], partnerGap: null, proAm: null, broke: false, breakRank: null,
  deepestOutround: null, won: null, speakerRank: null, ...o,
});
const rung = (f: ReturnType<typeof outroundFunnel>, key: string) => f!.rungs.find((r) => r.key === key)!;

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
      ['spoken', 6], ['broke', 5], ['quarterfinal', 4], ['semifinal', 3], ['final', 2], ['won', 1],
    ]);
    expect(rung(f, 'semifinal')).toMatchObject({ from: 4, of: 3 });
    expect(rung(f, 'won')).toMatchObject({ from: 2, of: 1 });
    expect(rung(f, 'spoken').from).toBeNull();
  });

  test('substring trap: Octofinals and partial rounds contain "final" but reach no quarterfinal', () => {
    const f = outroundFunnel([
      t({ broke: true, deepestOutround: 'Octofinals' }),
      t({ broke: true, deepestOutround: 'Partial Double Octofinals' }),
      t({ broke: true, deepestOutround: 'Double Octofinals' }),
      // A partial quarterfinal is played BEFORE the quarterfinal.
      t({ broke: true, deepestOutround: 'Partial Quarterfinals' }),
    ]);
    expect(rung(f, 'broke').count).toBe(4);
    expect(rung(f, 'quarterfinal').count).toBe(0);
    expect(rung(f, 'final').count).toBe(0);
    expect(f!.unknownDepth).toBe(0);
  });

  test('category-prefixed stages count at their stage, the same as reachedFinal', () => {
    const f = outroundFunnel([
      t({ broke: true, deepestOutround: 'ESL Final' }),
      t({ broke: true, deepestOutround: 'Novice Semifinals' }),
      t({ broke: true, deepestOutround: 'Final' }),
    ]);
    expect(rung(f, 'final').count).toBe(2);
    expect(rung(f, 'semifinal').count).toBe(3);
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
    // Broke → quarterfinal compares only the breaks whose depth is known.
    expect(rung(f, 'quarterfinal')).toMatchObject({ count: 1, from: 2, of: 1 });
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
    expect(rung(f, 'quarterfinal').from).toBe(0);
  });
});
