import { describe, expect, test } from 'vitest';
import { crossTab, crossTabFindings, MIN_FINDING_DELTA } from '@/lib/cv/crossTabs';
import { MIN_SPLIT_ROUNDS } from '@/lib/cv/roundSplits';
import type { RoundFact } from '@/lib/cv/statsFacts';

const round = (o: Partial<RoundFact>): RoundFact => ({
  tournamentId: '1', year: 2024, format: 'British Parliamentary', round: 1, isOutround: false,
  seat: 'BP:OG', partners: ['Ann'], partnerGap: 0, proAm: 'peers', motionType: 'Policy',
  hasMotion: true, contextLed: false, infoSlide: false, score: 75, partnerScores: [75], points: 2, won: false,
  ...o,
});

/** n rounds with the given shape, spread over two tournaments so findings may use them. */
const many = (n: number, o: Partial<RoundFact>, start = 1): RoundFact[] =>
  Array.from({ length: n }, (_, i) => round({ round: start + i, tournamentId: String(1 + (i % 2)), ...o }));

describe('crossTab', () => {
  test('crosses two dimensions over prelims, with rows and columns in a stable order', () => {
    const tab = crossTab(
      [
        ...many(6, { seat: 'BP:OG', motionType: 'Belief', score: 77 }),
        ...many(6, { seat: 'BP:CG', motionType: 'Policy', score: 73 }, 20),
        round({ seat: 'BP:OG', motionType: 'Policy', round: 40, isOutround: true }),
      ],
      'seat',
      'motionType',
    );
    expect(tab.rows).toEqual(['BP:OG', 'BP:CG']);
    expect(tab.cols).toEqual(['Policy', 'Belief']);
    const cell = tab.cells.find((c) => c.row === 'BP:OG' && c.col === 'Belief')!;
    expect(cell).toMatchObject({ rounds: 6, hidden: false, avgScore: 77 });
    // Per-format residual: BP mean is 75, so +2.
    expect(cell.scoreDelta).toBeCloseTo(2);
    // The outround never reaches a cell.
    expect(tab.cells.find((c) => c.row === 'BP:OG' && c.col === 'Policy')).toBeUndefined();
  });

  test('a cell under the minimum sample is hidden and carries no figures', () => {
    const tab = crossTab(
      [...many(MIN_SPLIT_ROUNDS - 1, { motionType: 'Regret', score: 90, won: true }), ...many(6, {}, 20)],
      'seat',
      'motionType',
    );
    const thin = tab.cells.find((c) => c.col === 'Regret')!;
    expect(thin).toMatchObject({ rounds: MIN_SPLIT_ROUNDS - 1, hidden: true });
    expect(thin.avgScore).toBeNull();
    expect(thin.scoreDelta).toBeNull();
    expect(thin.winRate).toBeNull();
    expect(thin.avgPoints).toBeNull();
  });

  test('rounds missing either key are left out rather than bucketed as unknown', () => {
    const tab = crossTab(
      [...many(6, { motionType: null }), ...many(6, { seat: null }, 20), ...many(6, {}, 40)],
      'seat',
      'motionType',
    );
    expect(tab.cells).toHaveLength(1);
    expect(tab.cells[0]).toMatchObject({ row: 'BP:OG', col: 'Policy', rounds: 6 });
  });

  test('pairing is a dimension, unlabelled tournaments excluded', () => {
    const tab = crossTab(
      [...many(6, { proAm: 'pro' }), ...many(6, { proAm: null }, 20)],
      'pairing',
      'motionType',
    );
    expect(tab.rows).toEqual(['pro']);
  });
});

describe('crossTabFindings', () => {
  // BP baseline over these rounds: (78·8 + 72·8 + 75·16) / 32 = 75.
  const rounds = [
    ...many(8, { seat: 'BP:OG', motionType: 'Belief', score: 78 }),
    ...many(8, { seat: 'BP:CO', motionType: 'Policy', score: 72 }, 20),
    ...many(16, { seat: 'BP:CG', motionType: 'Stance', score: 75 }, 40),
  ];

  test('names the strongest and weakest cells with the number and the sample', () => {
    const findings = crossTabFindings([crossTab(rounds, 'seat', 'motionType')]);
    expect(findings.map((f) => f.tone)).toEqual(['pos', 'neg']);
    expect(findings[0].text).toContain('OG');
    expect(findings[0].text).toContain('Belief');
    expect(findings[0].text).toContain('+3.0');
    expect(findings[0].basis).toBe('8 rounds at 2 tournaments');
    expect(findings[1].text).toContain('CO');
    expect(findings[1].text).toContain('−3.0');
    // A cell at the baseline is not a finding.
    expect(findings.some((f) => f.text.includes('Stance'))).toBe(false);
  });

  test('small deltas, hidden cells and single-tournament cells are never findings', () => {
    const quiet = [
      ...many(8, { seat: 'BP:OG', score: 75 + MIN_FINDING_DELTA / 4 }),
      ...many(8, { seat: 'BP:CO', score: 75 - MIN_FINDING_DELTA / 4 }, 20),
      // Large deltas but one tournament each (symmetric, so the baseline stays 75).
      ...Array.from({ length: 8 }, (_, i) => round({ seat: 'BP:CG', motionType: 'Actor', score: 85, round: 40 + i, tournamentId: '9' })),
      ...Array.from({ length: 8 }, (_, i) => round({ seat: 'BP:CG', motionType: 'Belief', score: 65, round: 50 + i, tournamentId: '8' })),
      // Large deltas but hidden.
      ...many(3, { seat: 'BP:OO', motionType: 'Regret', score: 60 }, 60),
      ...many(3, { seat: 'BP:OO', motionType: 'Preference', score: 90 }, 70),
    ];
    expect(crossTabFindings([crossTab(quiet, 'seat', 'motionType')])).toEqual([]);
  });

  test('at most three each way, strongest first, across several grids', () => {
    const seats = ['BP:OG', 'BP:OO', 'BP:CG', 'BP:CO'];
    const types = ['Policy', 'Belief'] as const;
    let start = 1;
    const spread: RoundFact[] = [];
    seats.forEach((seat, i) =>
      types.forEach((motionType, j) => {
        spread.push(...many(6, { seat, motionType, score: 75 + (i * 2 + j - 3.5) }, start));
        start += 10;
      }),
    );
    const findings = crossTabFindings([crossTab(spread, 'seat', 'motionType'), crossTab(spread, 'motionType', 'seat')]);
    const pos = findings.filter((f) => f.tone === 'pos');
    const neg = findings.filter((f) => f.tone === 'neg');
    expect(pos).toHaveLength(3);
    expect(neg).toHaveLength(3);
    // The same cell seen from two grids is one finding.
    expect(new Set(findings.map((f) => f.id)).size).toBe(findings.length);
    expect(pos[0].text).toContain('+3.5');
  });

  test('a cell spanning formats says the comparison is within each format', () => {
    const mixed = [
      ...many(6, { proAm: 'pro', motionType: 'Policy', score: 78 }),
      ...many(6, { proAm: 'pro', motionType: 'Policy', score: 82, format: 'Asian Parliamentary', seat: 'AP:Gov' }, 20),
      ...many(6, { proAm: 'pro', motionType: 'Belief', score: 72 }, 40),
      ...many(6, { proAm: 'pro', motionType: 'Belief', score: 78, format: 'Asian Parliamentary', seat: 'AP:Gov' }, 60),
      // Peers rounds at each format's baseline, so "pro" is not the whole grid.
      ...many(12, { proAm: 'peers', motionType: 'Stance', score: 75 }, 80),
      ...many(12, { proAm: 'peers', motionType: 'Stance', score: 80, format: 'Asian Parliamentary', seat: 'AP:Gov' }, 100),
    ];
    const [top] = crossTabFindings([crossTab(mixed, 'pairing', 'motionType')]);
    expect(top.text).toContain('As the pro');
    expect(top.text).toContain('each format');
  });
});

describe('crossTabFindings — dominant keys', () => {
  test('a key covering most of a grid adds nothing to the other dimension, so it is not a finding', () => {
    // "With peers" is nearly every round: "with peers on Belief motions" is just
    // "on Belief motions". The pro cell is a real cross.
    const rounds = [
      ...many(40, { proAm: 'peers', motionType: 'Belief', score: 77 }),
      ...many(40, { proAm: 'peers', motionType: 'Policy', score: 73 }, 100),
      ...many(8, { proAm: 'pro', motionType: 'Policy', score: 78 }, 200),
    ];
    const findings = crossTabFindings([crossTab(rounds, 'pairing', 'motionType')]);
    expect(findings.some((f) => f.text.startsWith('With peers'))).toBe(false);
    expect(findings.some((f) => f.text.startsWith('As the pro'))).toBe(true);
  });
});
