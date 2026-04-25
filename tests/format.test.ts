import { describe, expect, test } from 'vitest';
import { detectFormatFromTeamSize } from '@/lib/calicotab/format';

describe('detectFormatFromTeamSize', () => {
  test('2 → British Parliamentary', () => {
    expect(detectFormatFromTeamSize(2)).toBe('British Parliamentary');
  });

  test('3 → Asian Parliamentary', () => {
    expect(detectFormatFromTeamSize(3)).toBe('Asian Parliamentary');
  });

  test.each([0, 1, 4, 5, 12])('%d → unknown', (n) => {
    expect(detectFormatFromTeamSize(n)).toBe('unknown');
  });

  test.each([NaN, Infinity, -Infinity, -1, -2])('malformed input %s → unknown', (n) => {
    expect(detectFormatFromTeamSize(n)).toBe('unknown');
  });

  test('non-integers like 2.5 → unknown', () => {
    expect(detectFormatFromTeamSize(2.5)).toBe('unknown');
  });

  test('non-numbers via type-coercion bypass → unknown', () => {
    expect(detectFormatFromTeamSize('2' as unknown as number)).toBe('unknown');
    expect(detectFormatFromTeamSize(null as unknown as number)).toBe('unknown');
    expect(detectFormatFromTeamSize(undefined as unknown as number)).toBe('unknown');
  });
});
