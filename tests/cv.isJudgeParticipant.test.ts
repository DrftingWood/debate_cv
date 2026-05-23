import { describe, expect, test } from 'vitest';
import { isJudgeParticipant } from '@/lib/cv/roleClassification';

describe('isJudgeParticipant', () => {
  test('returns true when roles contains a judge role row', () => {
    expect(isJudgeParticipant({ roles: [{ role: 'judge' }] })).toBe(true);
  });

  test('returns true when roles contains judge among other roles', () => {
    expect(
      isJudgeParticipant({ roles: [{ role: 'speaker' }, { role: 'judge' }] }),
    ).toBe(true);
  });

  test('returns false when roles is empty', () => {
    expect(isJudgeParticipant({ roles: [] })).toBe(false);
  });

  test('returns false when roles contains only non-judge roles', () => {
    expect(isJudgeParticipant({ roles: [{ role: 'speaker' }] })).toBe(false);
  });

  test('treats role names case-sensitively (lowercase only)', () => {
    // Tabbycat consistently writes 'judge' lowercase; we don't normalise.
    expect(isJudgeParticipant({ roles: [{ role: 'Judge' }] })).toBe(false);
    expect(isJudgeParticipant({ roles: [{ role: 'JUDGE' }] })).toBe(false);
  });
});
