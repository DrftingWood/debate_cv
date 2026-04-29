import { describe, expect, test } from 'vitest';
import {
  breakCategoryPriority,
  deepestOutroundsByCategory,
  isEudcTournament,
  resolveTeamBreaks,
  splitOutroundStage,
} from '@/lib/calicotab/breakCategoryResolve';
import { outroundRank } from '@/lib/calicotab/judgeStats';

const rankStage = (stage: string) =>
  outroundRank({ roundLabel: stage, roundNumber: null, isOutround: true });

describe('breakCategoryPriority', () => {
  test('Open beats ESL beats EFL beats other beats null', () => {
    expect(breakCategoryPriority('Open')).toBeGreaterThan(breakCategoryPriority('ESL'));
    expect(breakCategoryPriority('ESL')).toBeGreaterThan(breakCategoryPriority('EFL'));
    expect(breakCategoryPriority('EFL')).toBeGreaterThan(breakCategoryPriority('Novice'));
    expect(breakCategoryPriority('Novice')).toBeGreaterThan(breakCategoryPriority(null));
  });
});

describe('resolveTeamBreaks', () => {
  test('returns the highest-priority break for each team', () => {
    // Audit follow-up: explicit coverage of the case the comment in
    // ingest.ts called out — same team in BOTH Open and ESL break tabs.
    // Open must win regardless of input order.
    const { rankByTeam, stageByTeam } = resolveTeamBreaks([
      { entityType: 'team', entityName: 'Mysore 1', rank: 14, stage: 'ESL' },
      { entityType: 'team', entityName: 'Mysore 1', rank: 12, stage: 'Open' },
    ]);
    expect(rankByTeam.get('Mysore 1')).toBe(12);
    expect(stageByTeam.get('Mysore 1')).toBe('Open');
  });

  test('order-independent: ESL-first input yields the same Open answer', () => {
    const { rankByTeam, stageByTeam } = resolveTeamBreaks([
      { entityType: 'team', entityName: 'Mysore 1', rank: 12, stage: 'Open' },
      { entityType: 'team', entityName: 'Mysore 1', rank: 14, stage: 'ESL' },
    ]);
    expect(rankByTeam.get('Mysore 1')).toBe(12);
    expect(stageByTeam.get('Mysore 1')).toBe('Open');
  });

  test('keeps a single-category break when only one is present', () => {
    const { rankByTeam, stageByTeam } = resolveTeamBreaks([
      { entityType: 'team', entityName: 'Solo', rank: 8, stage: 'EFL' },
    ]);
    expect(rankByTeam.get('Solo')).toBe(8);
    expect(stageByTeam.get('Solo')).toBe('EFL');
  });

  test('skips adjudicator break rows entirely', () => {
    const { rankByTeam } = resolveTeamBreaks([
      { entityType: 'adjudicator', entityName: 'Some Judge', rank: 1, stage: 'Open' },
      { entityType: 'team', entityName: 'Some Team', rank: 1, stage: 'Open' },
    ]);
    expect(rankByTeam.has('Some Judge')).toBe(false);
    expect(rankByTeam.get('Some Team')).toBe(1);
  });

  test('skips rows with null rank (incomplete data)', () => {
    const { rankByTeam } = resolveTeamBreaks([
      { entityType: 'team', entityName: 'Incomplete', rank: null, stage: 'Open' },
    ]);
    expect(rankByTeam.has('Incomplete')).toBe(false);
  });

  test('handles multiple distinct teams independently', () => {
    const { rankByTeam, stageByTeam } = resolveTeamBreaks([
      { entityType: 'team', entityName: 'A', rank: 1, stage: 'Open' },
      { entityType: 'team', entityName: 'B', rank: 5, stage: 'ESL' },
      { entityType: 'team', entityName: 'B', rank: 9, stage: 'EFL' },
    ]);
    expect(rankByTeam.get('A')).toBe(1);
    expect(stageByTeam.get('A')).toBe('Open');
    expect(rankByTeam.get('B')).toBe(5);
    expect(stageByTeam.get('B')).toBe('ESL');
  });

  test('treats unknown category labels as priority below the canonical three', () => {
    const { rankByTeam, stageByTeam } = resolveTeamBreaks([
      { entityType: 'team', entityName: 'X', rank: 3, stage: 'Novice' },
      { entityType: 'team', entityName: 'X', rank: 9, stage: 'EFL' },
    ]);
    // EFL outranks Novice, so EFL wins even though it has a worse rank
    // number — semantic priority, not numeric.
    expect(rankByTeam.get('X')).toBe(9);
    expect(stageByTeam.get('X')).toBe('EFL');
  });
});

describe('splitOutroundStage', () => {
  test('strips canonical category prefixes', () => {
    expect(splitOutroundStage('ESL Grand Final')).toEqual({
      category: 'ESL',
      baseStage: 'Grand Final',
    });
    expect(splitOutroundStage('EFL Octofinals')).toEqual({
      category: 'EFL',
      baseStage: 'Octofinals',
    });
    expect(splitOutroundStage('Novice Final')).toEqual({
      category: 'Novice',
      baseStage: 'Final',
    });
    expect(splitOutroundStage('Open Semifinal')).toEqual({
      category: 'Open',
      baseStage: 'Semifinal',
    });
  });

  test('normalises lowercase prefixes', () => {
    expect(splitOutroundStage('esl quarterfinal').category).toBe('ESL');
    expect(splitOutroundStage('novice final').category).toBe('Novice');
  });

  test('returns null category for bare stage labels', () => {
    expect(splitOutroundStage('Octofinals')).toEqual({
      category: null,
      baseStage: 'Octofinals',
    });
    expect(splitOutroundStage('Grand Final')).toEqual({
      category: null,
      baseStage: 'Grand Final',
    });
  });

  test('handles null / empty input', () => {
    expect(splitOutroundStage(null)).toEqual({ category: null, baseStage: null });
    expect(splitOutroundStage('')).toEqual({ category: null, baseStage: null });
  });
});

describe('deepestOutroundsByCategory', () => {
  test('EUDC dual-break: keeps deepest per category, sorted by priority', () => {
    const stages = [
      'Octofinals',
      'Quarterfinals',
      'ESL Octofinals',
      'ESL Quarterfinals',
      'ESL Semifinals',
      'ESL Grand Final',
    ];
    const result = deepestOutroundsByCategory(stages, rankStage);
    expect(result).toEqual([
      { category: 'Open', stage: 'Quarterfinals' },
      { category: 'ESL', stage: 'ESL Grand Final' },
    ]);
  });

  test('single category yields single entry', () => {
    const result = deepestOutroundsByCategory(
      ['Octofinals', 'Quarterfinals', 'Semifinals'],
      rankStage,
    );
    expect(result).toEqual([{ category: 'Open', stage: 'Semifinals' }]);
  });

  test('bare labels are bucketed as Open by EUDC convention', () => {
    const result = deepestOutroundsByCategory(['Grand Final'], rankStage);
    expect(result).toEqual([{ category: 'Open', stage: 'Grand Final' }]);
  });

  test('skips null / empty / unrankable stages', () => {
    const result = deepestOutroundsByCategory(
      [null, '', 'ESL Final', 'Some Random Label'],
      rankStage,
    );
    expect(result).toEqual([{ category: 'ESL', stage: 'ESL Final' }]);
  });

  test('Open is ordered before ESL even when input is shuffled', () => {
    const result = deepestOutroundsByCategory(
      ['ESL Final', 'Octofinals'],
      rankStage,
    );
    expect(result.map((e) => e.category)).toEqual(['Open', 'ESL']);
  });
});

describe('isEudcTournament', () => {
  test('matches EUDC and the long form', () => {
    expect(isEudcTournament('EUDC 2024')).toBe(true);
    expect(isEudcTournament('Belgrade EUDC')).toBe(true);
    expect(isEudcTournament('European Universities Debating Championship 2023')).toBe(true);
    expect(isEudcTournament('eudc 2019')).toBe(true);
  });

  test('rejects unrelated tournaments', () => {
    expect(isEudcTournament('WUDC 2024')).toBe(false);
    expect(isEudcTournament('Australs')).toBe(false);
    expect(isEudcTournament(null)).toBe(false);
    expect(isEudcTournament('')).toBe(false);
  });
});
