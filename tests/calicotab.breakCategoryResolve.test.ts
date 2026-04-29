import { describe, expect, test } from 'vitest';
import {
  breakCategoryPriority,
  resolveTeamBreaks,
} from '@/lib/calicotab/breakCategoryResolve';

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
