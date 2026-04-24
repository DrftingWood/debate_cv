import { describe, expect, test } from 'vitest';
import { aggregateJudgeStats, outroundRank } from '@/lib/calicotab/judgeStats';

describe('outroundRank', () => {
  test('prelim rounds rank -1', () => {
    expect(outroundRank({ roundLabel: 'Round 4', roundNumber: 4, isOutround: false })).toBe(-1);
  });

  test('stage ordering: Grand Final > Final > Semi > Quarter > Octo', () => {
    const semi = outroundRank({ roundLabel: 'Semifinal 2', roundNumber: null, isOutround: true });
    const quarter = outroundRank({ roundLabel: 'Quarterfinal 3', roundNumber: null, isOutround: true });
    const octo = outroundRank({ roundLabel: 'Octofinal', roundNumber: null, isOutround: true });
    const grand = outroundRank({ roundLabel: 'Grand Final', roundNumber: null, isOutround: true });
    expect(grand).toBeGreaterThan(semi);
    expect(semi).toBeGreaterThan(quarter);
    expect(quarter).toBeGreaterThan(octo);
  });

  test('numeric-only outround labels fall back to round number', () => {
    const r9 = outroundRank({ roundLabel: 'Round 9', roundNumber: 9, isOutround: true });
    const r8 = outroundRank({ roundLabel: 'Round 8', roundNumber: 8, isOutround: true });
    expect(r9).toBeGreaterThan(r8);
  });
});

describe('aggregateJudgeStats — chairedPrelimRounds', () => {
  test('dedups when the same judge chairs two rooms in the same round', () => {
    const stats = aggregateJudgeStats([
      {
        roundNumber: 1,
        roundLabel: 'Round 1',
        isOutround: false,
        judgeAssignments: [
          { personKey: 'A', panelRole: 'chair' },
          { personKey: 'A', panelRole: 'chair' },
        ],
      },
    ]);
    expect(stats.get('A')?.chairedPrelimRounds).toBe(1);
  });

  test('counts distinct prelim rounds separately', () => {
    const stats = aggregateJudgeStats([
      { roundNumber: 1, roundLabel: 'R1', isOutround: false, judgeAssignments: [{ personKey: 'A', panelRole: 'chair' }] },
      { roundNumber: 2, roundLabel: 'R2', isOutround: false, judgeAssignments: [{ personKey: 'A', panelRole: 'chair' }] },
      { roundNumber: 3, roundLabel: 'R3', isOutround: false, judgeAssignments: [{ personKey: 'A', panelRole: 'panel' }] },
    ]);
    expect(stats.get('A')?.chairedPrelimRounds).toBe(2);
  });

  test('prelim rounds beyond R5 do not count (BP tournaments with 6+ prelims still need this ceiling)', () => {
    const stats = aggregateJudgeStats([
      { roundNumber: 5, roundLabel: 'R5', isOutround: false, judgeAssignments: [{ personKey: 'A', panelRole: 'chair' }] },
      { roundNumber: 6, roundLabel: 'R6', isOutround: false, judgeAssignments: [{ personKey: 'A', panelRole: 'chair' }] },
    ]);
    // R5 counts, R6 does not.
    expect(stats.get('A')?.chairedPrelimRounds).toBe(1);
  });
});

describe('aggregateJudgeStats — last outround', () => {
  test('keeps the latest outround regardless of iteration order', () => {
    const rounds = [
      {
        roundNumber: null,
        roundLabel: 'Octofinal',
        isOutround: true,
        judgeAssignments: [{ personKey: 'A', panelRole: 'chair' as const }],
      },
      {
        roundNumber: null,
        roundLabel: 'Grand Final',
        isOutround: true,
        judgeAssignments: [{ personKey: 'A', panelRole: 'chair' as const }],
      },
      {
        roundNumber: null,
        roundLabel: 'Semifinal 2',
        isOutround: true,
        judgeAssignments: [{ personKey: 'A', panelRole: 'chair' as const }],
      },
    ];
    const stats = aggregateJudgeStats(rounds);
    expect(stats.get('A')?.lastOutroundChaired).toBe('Grand Final');
  });

  test('tracks chair and panel ladders independently', () => {
    const stats = aggregateJudgeStats([
      {
        roundNumber: null,
        roundLabel: 'Grand Final',
        isOutround: true,
        judgeAssignments: [{ personKey: 'A', panelRole: 'panel' }],
      },
      {
        roundNumber: null,
        roundLabel: 'Semifinal 1',
        isOutround: true,
        judgeAssignments: [{ personKey: 'A', panelRole: 'chair' }],
      },
    ]);
    const s = stats.get('A')!;
    expect(s.lastOutroundChaired).toBe('Semifinal 1');
    expect(s.lastOutroundPaneled).toBe('Grand Final');
  });
});
