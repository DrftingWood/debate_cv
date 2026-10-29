import { describe, expect, test } from 'vitest';
import { crossTab, crossTabFindings } from '@/lib/cv/crossTabs';
import { MIN_SPLIT_ROUNDS } from '@/lib/cv/roundSplits';
import type { RoundFact } from '@/lib/cv/statsFacts';

const round = (o: Partial<RoundFact>): RoundFact => ({
  tournamentId: '1',
  year: 2024,
  format: 'British Parliamentary',
  round: 1,
  isOutround: false,
  seat: 'BP:OG',
  partners: ['Ann'],
  partnerGap: 0,
  proAm: 'unmarked',
  motionType: 'Policy',
  hasMotion: true,
  contextLed: false,
  infoSlide: false,
  score: 75,
  partnerScores: [75],
  points: 2,
  won: false,
  ...o,
});

/** n rounds with the given shape, spread over two tournaments so findings may use them. */
const many = (n: number, o: Partial<RoundFact>, start = 1): RoundFact[] =>
  Array.from({ length: n }, (_, i) =>
    round({ round: start + i, tournamentId: String(1 + (i % 2)), ...o }),
  );

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
      [
        ...many(MIN_SPLIT_ROUNDS - 1, { motionType: 'Regret', score: 90, won: true }),
        ...many(6, {}, 20),
      ],
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
      [...many(6, { proAm: 'marked' }), ...many(6, { proAm: null }, 20)],
      'pairing',
      'motionType',
    );
    expect(tab.rows).toEqual(['marked']);
  });
});

/**
 * A 2×2 grid, 6 rounds per cell over two tournaments. `extra` adds an
 * interaction on top of additive seat and motion effects.
 */
function grid(
  cells: Record<string, number>,
  o: Partial<RoundFact> = {},
  dims: { rows: [string, string]; cols: [string, string]; rowField: 'seat' | 'proAm' } = {
    rows: ['BP:OG', 'BP:OO'],
    cols: ['Belief', 'Policy'],
    rowField: 'seat',
  },
): RoundFact[] {
  let start = 1;
  const out: RoundFact[] = [];
  for (const row of dims.rows) {
    for (const col of dims.cols) {
      out.push(
        ...many(
          6,
          {
            [dims.rowField]: row,
            motionType: col,
            score: cells[`${row}|${col}`],
            ...o,
          } as Partial<RoundFact>,
          start,
        ),
      );
      start += 10;
    }
  }
  return out;
}

describe('crossTabFindings', () => {
  test('purely additive effects are not findings — each is already its own row or column', () => {
    // OG +1, OO −1, Belief +1, Policy −1, no interaction.
    const rounds = grid({
      'BP:OG|Belief': 77,
      'BP:OG|Policy': 75,
      'BP:OO|Belief': 75,
      'BP:OO|Policy': 73,
    });
    expect(crossTabFindings([crossTab(rounds, 'seat', 'motionType')])).toEqual([]);
  });

  // Additive grid plus +2 on OG×Belief and −2 on OO×Belief. Row effects OG +2,
  // OO −2; column effects Belief +1, Policy −1. Interactions: OG×Belief +1,
  // OO×Policy +1, OG×Policy −1, OO×Belief −1.
  const interacting = {
    'BP:OG|Belief': 79,
    'BP:OG|Policy': 75,
    'BP:OO|Belief': 73,
    'BP:OO|Policy': 73,
  };

  test('a cell is a finding by how far it sits from what its row and column predict', () => {
    const tab = crossTab(grid(interacting), 'seat', 'motionType');
    const cell = tab.cells.find((c) => c.row === 'BP:OG' && c.col === 'Belief')!;
    expect(cell.scoreDelta).toBeCloseTo(4);
    expect(cell.expected).toBeCloseTo(3);
    expect(cell.interaction).toBeCloseTo(1);

    const findings = crossTabFindings([tab]);
    expect(findings.filter((f) => f.tone === 'pos')).toHaveLength(2);
    expect(findings.filter((f) => f.tone === 'neg')).toHaveLength(2);
    const og = findings.find((f) => f.text.includes('OG') && f.text.includes('Belief'))!;
    expect(og.tone).toBe('pos');
    expect(og.text).toContain('+4.0');
    expect(og.text).toContain('1.0 above what OG and Belief motions predict');
    expect(og.basis).toBe('6 rounds at 2 tournaments');
    const oo = findings.find((f) => f.text.includes('OO') && f.text.includes('Belief'))!;
    expect(oo.tone).toBe('neg');
    expect(oo.text).toContain('1.0 below');
  });

  test('under a seat filter the seat keeps its findings: effects come from the whole record', () => {
    const all = grid(interacting);
    const ogOnly = all.filter((r) => r.seat === 'BP:OG');
    const findings = crossTabFindings([crossTab(ogOnly, 'seat', 'motionType', all)]);
    expect(findings.map((f) => f.tone).sort()).toEqual(['neg', 'pos']);
    expect(findings.every((f) => f.text.includes('OG'))).toBe(true);
  });

  test('hidden cells, single-tournament cells and small interactions are never findings', () => {
    const small = grid({
      'BP:OG|Belief': 77.2,
      'BP:OG|Policy': 74.8,
      'BP:OO|Belief': 74.8,
      'BP:OO|Policy': 73.2,
    });
    expect(crossTabFindings([crossTab(small, 'seat', 'motionType')])).toEqual([]);

    const oneTournament = grid(interacting, { tournamentId: '7' });
    expect(crossTabFindings([crossTab(oneTournament, 'seat', 'motionType')])).toEqual([]);

    const thin = grid(interacting).filter(
      (r) => !(r.seat === 'BP:OG' && r.motionType === 'Belief' && r.round > 3),
    );
    const ids = crossTabFindings([crossTab(thin, 'seat', 'motionType')]).map((f) => f.text);
    expect(ids.some((t) => t.includes('OG') && t.includes('Belief'))).toBe(false);
  });

  test('at most three each way, largest interaction first', () => {
    const seats = ['BP:OG', 'BP:OO', 'BP:CG', 'BP:CO'];
    const v = [4, 3, 2, 1];
    const rounds: RoundFact[] = [];
    let start = 1;
    seats.forEach((seat, i) => {
      rounds.push(...many(6, { seat, motionType: 'Policy', score: 75 + v[i] }, start));
      rounds.push(...many(6, { seat, motionType: 'Belief', score: 75 - v[i] }, start + 10));
      start += 20;
    });
    const findings = crossTabFindings([crossTab(rounds, 'seat', 'motionType')]);
    expect(findings.filter((f) => f.tone === 'pos')).toHaveLength(3);
    expect(findings.filter((f) => f.tone === 'neg')).toHaveLength(3);
    expect(findings[0].text).toContain('1.5 above');
  });

  test('the same tab given twice yields each finding once', () => {
    const tab = crossTab(grid(interacting), 'seat', 'motionType');
    const findings = crossTabFindings([tab, tab]);
    expect(new Set(findings.map((f) => f.id)).size).toBe(findings.length);
    expect(findings).toHaveLength(4);
  });

  test('the format named is the one the seat names; a cell spanning formats says "each format"', () => {
    const mislabelled = crossTabFindings([
      crossTab(grid(interacting, { format: 'Asian Parliamentary' }), 'seat', 'motionType'),
    ]);
    expect(mislabelled[0].text).toContain('British Parliamentary');

    const pairingDims = {
      rows: ['marked', 'unmarked'] as [string, string],
      cols: ['Belief', 'Policy'] as [string, string],
      rowField: 'proAm' as const,
    };
    const cells = {
      'marked|Belief': 79,
      'marked|Policy': 75,
      'unmarked|Belief': 73,
      'unmarked|Policy': 73,
    };
    const bp = grid(cells, { format: 'British Parliamentary', seat: 'BP:OG' }, pairingDims);
    const ap = grid(
      Object.fromEntries(Object.entries(cells).map(([k, s]) => [k, s + 5])),
      { format: 'Asian Parliamentary', seat: 'AP:Gov', tournamentId: '5' },
      pairingDims,
    ).map((r, i) => ({ ...r, round: r.round + 100, tournamentId: String(5 + (i % 2)) }));
    const [top] = crossTabFindings([crossTab([...bp, ...ap], 'pairing', 'motionType')]);
    expect(top.text).toMatch(/^In pairings you marked pro-am/);
    expect(top.text).toContain('each format');
  });
});
