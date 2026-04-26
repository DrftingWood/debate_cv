import { describe, expect, test } from 'vitest';
import {
  classifyRoundLabel,
  getInroundsChairedCount,
} from '@/lib/calicotab/judgeStats';

describe('classifyRoundLabel', () => {
  test.each(['1', '2', '3', '15'])('numeric %s → inround', (s) => {
    expect(classifyRoundLabel(s)).toBe('inround');
  });

  test.each(['Round 1', 'Round 6', 'round 12', 'ROUND 4'])(
    '"Round N" form %s → inround',
    (s) => {
      expect(classifyRoundLabel(s)).toBe('inround');
    },
  );

  test.each(['QF', 'SF', 'F', 'GF', 'qf', 'gf'])('abbreviation %s → outround', (s) => {
    expect(classifyRoundLabel(s)).toBe('outround');
  });

  test.each(['R1', 'R2', 'r3', 'R12'])(
    '"R\\d+" abbreviation %s → inround (Tabbycat tooltip-trigger form)',
    (s) => {
      expect(classifyRoundLabel(s)).toBe('inround');
    },
  );

  test.each(['Octos', 'Doubles', 'Triples', 'Quarters', 'Semis', 'octos', 'semis'])(
    'bare colloquial outround %s → outround',
    (s) => {
      expect(classifyRoundLabel(s)).toBe('outround');
    },
  );

  test.each([
    'Quarterfinals',
    'Quarter Final',
    'Semifinals',
    'Semi-final',
    'Finals',
    'Grand Final',
    'Grand Finals',
    'Octofinals',
    'Round of 16',
    'Round of 32',
  ])('full word form %s → outround', (s) => {
    expect(classifyRoundLabel(s)).toBe('outround');
  });

  test('"Round of N" is not mis-stripped to "of N" — stays outround', () => {
    expect(classifyRoundLabel('Round of 16')).toBe('outround');
    expect(classifyRoundLabel('Round of 32')).toBe('outround');
  });

  test.each(['', '   ', null, undefined])('empty input %s → unknown', (s) => {
    expect(classifyRoundLabel(s as string | null | undefined)).toBe('unknown');
  });

  test.each(['Reply 1', 'Round one', 'Lunch break', '1A', 'foo'])(
    'malformed/unsupported %s → unknown',
    (s) => {
      expect(classifyRoundLabel(s)).toBe('unknown');
    },
  );

  test('whitespace is trimmed before classification', () => {
    expect(classifyRoundLabel('  3  ')).toBe('inround');
    expect(classifyRoundLabel('  QF  ')).toBe('outround');
  });

  test('non-string input does not throw', () => {
    expect(classifyRoundLabel(42 as unknown as string)).toBe('unknown');
    expect(classifyRoundLabel({} as unknown as string)).toBe('unknown');
  });
});

describe('getInroundsChairedCount', () => {
  test('counts only inrounds where role is chair', () => {
    const data = [
      { stage: 'Round 1', panelRole: 'chair' }, //  ✓
      { stage: 'Round 2', panelRole: 'chair' }, //  ✓
      { stage: 'Round 3', panelRole: 'panellist' }, //  ✗ (not chair)
      { stage: 'QF', panelRole: 'chair' }, //  ✗ (outround)
      { stage: 'Finals', panelRole: 'chair' }, //  ✗ (outround)
      { stage: '4', panelRole: 'chair' }, //  ✓ (numeric inround)
    ];
    expect(getInroundsChairedCount(data)).toBe(3);
  });

  test('case-insensitive role matching', () => {
    expect(
      getInroundsChairedCount([
        { stage: '1', panelRole: 'CHAIR' },
        { stage: '2', panelRole: 'Chair' },
        { stage: '3', panelRole: ' chair ' },
      ]),
    ).toBe(3);
  });

  test('empty array → 0', () => {
    expect(getInroundsChairedCount([])).toBe(0);
  });

  test('null / undefined / non-array → 0', () => {
    expect(getInroundsChairedCount(null)).toBe(0);
    expect(getInroundsChairedCount(undefined)).toBe(0);
    expect(
      getInroundsChairedCount('not an array' as unknown as never),
    ).toBe(0);
  });

  test('skips malformed entries without throwing', () => {
    const data = [
      { stage: 'Round 1', panelRole: 'chair' },
      null as unknown as { stage: string; panelRole: string },
      undefined as unknown as { stage: string; panelRole: string },
      { stage: null, panelRole: 'chair' }, // unknown stage
      { stage: 'Round 2', panelRole: null }, // null role
      { stage: 'Round 3', panelRole: 'chair' },
    ];
    expect(getInroundsChairedCount(data)).toBe(2);
  });

  test('SIDO 2026 sample — 6 prelim chairs + 1 QF panellist → 6', () => {
    const data = [
      { stage: 'Round 1', panelRole: 'chair' },
      { stage: 'Round 2', panelRole: 'chair' },
      { stage: 'Round 3', panelRole: 'chair' },
      { stage: 'Round 4', panelRole: 'chair' },
      { stage: 'Round 5', panelRole: 'chair' },
      { stage: 'Round 6', panelRole: 'chair' },
      { stage: 'Quarterfinals', panelRole: 'panellist' },
    ];
    expect(getInroundsChairedCount(data)).toBe(6);
  });

  test('SBS Debate 2026 sample — 5 prelim chairs, no outrounds → 5', () => {
    const data = [
      { stage: 'Round 1', panelRole: 'chair' },
      { stage: 'Round 2', panelRole: 'chair' },
      { stage: 'Round 3', panelRole: 'chair' },
      { stage: 'Round 4', panelRole: 'chair' },
      { stage: 'Round 5', panelRole: 'chair' },
    ];
    expect(getInroundsChairedCount(data)).toBe(5);
  });
});
