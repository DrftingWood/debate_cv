import { describe, expect, test } from 'vitest';
import { formatStageForDisplay } from '@/lib/cv/formatStage';

describe('formatStageForDisplay', () => {
  test('"Open Finals", "Grand Final", and "Final" all collapse to "Final"', () => {
    // The whole reason this helper exists — these strings drift across
    // Tabbycat deployments but mean the same championship round.
    expect(formatStageForDisplay('Final')).toBe('Final');
    expect(formatStageForDisplay('Finals')).toBe('Final');
    expect(formatStageForDisplay('Open Final')).toBe('Final');
    expect(formatStageForDisplay('Open Finals')).toBe('Final');
    expect(formatStageForDisplay('Grand Final')).toBe('Final');
    expect(formatStageForDisplay('Grand Finals')).toBe('Final');
    expect(formatStageForDisplay('GF')).toBe('Final');
  });

  test('strips category prefixes from non-final outround stages', () => {
    expect(formatStageForDisplay('Quarterfinals')).toBe('Quarterfinals');
    expect(formatStageForDisplay('Open Quarterfinals')).toBe('Quarterfinals');
    expect(formatStageForDisplay('ESL Semifinals')).toBe('Semifinals');
    expect(formatStageForDisplay('Novice Octofinals')).toBe('Octofinals');
  });

  test('canonicalises abbreviation forms', () => {
    expect(formatStageForDisplay('QF')).toBe('Quarterfinals');
    expect(formatStageForDisplay('SF')).toBe('Semifinals');
    expect(formatStageForDisplay('OF')).toBe('Octofinals');
    expect(formatStageForDisplay('Quarters')).toBe('Quarterfinals');
    expect(formatStageForDisplay('Semis')).toBe('Semifinals');
  });

  test('maps "Round of 16" / "Round of 32" to canonical octofinal stages', () => {
    expect(formatStageForDisplay('Round of 16')).toBe('Octofinals');
    expect(formatStageForDisplay('Round of 32')).toBe('Double Octofinals');
  });

  test('null / empty / unknown labels degrade gracefully', () => {
    expect(formatStageForDisplay(null)).toBe('');
    expect(formatStageForDisplay(undefined)).toBe('');
    expect(formatStageForDisplay('')).toBe('');
    // Unknown labels (prelims, garbage) pass through as-is so we never
    // hide data the classifier hasn't been taught to recognise.
    expect(formatStageForDisplay('Round 3')).toBe('Round 3');
    expect(formatStageForDisplay('Something Weird')).toBe('Something Weird');
  });
});
