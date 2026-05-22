import { describe, expect, test } from 'vitest';
import { isJudgeParticipant } from '@/lib/cv/roleClassification';

const empty = {
  roles: [] as ReadonlyArray<{ role: string }>,
  judgeTypeTag: null as string | null,
  chairedPrelimRounds: null as number | null,
  lastOutroundChaired: null as string | null,
  lastOutroundPaneled: null as string | null,
};

describe('isJudgeParticipant', () => {
  test('false when all signals are null/empty', () => {
    expect(isJudgeParticipant(empty)).toBe(false);
  });

  test("true when roles contains 'judge'", () => {
    expect(isJudgeParticipant({ ...empty, roles: [{ role: 'judge' }] })).toBe(true);
  });

  test('true when judgeTypeTag is set', () => {
    expect(isJudgeParticipant({ ...empty, judgeTypeTag: 'adj-core' })).toBe(true);
    expect(isJudgeParticipant({ ...empty, judgeTypeTag: 'CA' })).toBe(true);
  });

  test('true when chairedPrelimRounds > 0', () => {
    expect(isJudgeParticipant({ ...empty, chairedPrelimRounds: 3 })).toBe(true);
    expect(isJudgeParticipant({ ...empty, chairedPrelimRounds: 1 })).toBe(true);
  });

  test('false when chairedPrelimRounds is exactly 0 (guards against parsed-as-zero)', () => {
    expect(isJudgeParticipant({ ...empty, chairedPrelimRounds: 0 })).toBe(false);
  });

  test('true when lastOutroundChaired is set', () => {
    expect(isJudgeParticipant({ ...empty, lastOutroundChaired: 'Quarterfinals' })).toBe(true);
  });

  test('true when lastOutroundPaneled is set', () => {
    expect(isJudgeParticipant({ ...empty, lastOutroundPaneled: 'Semifinals' })).toBe(true);
  });

  test('roles array containing only non-judge roles does not count', () => {
    expect(isJudgeParticipant({ ...empty, roles: [{ role: 'speaker' }] })).toBe(false);
    expect(isJudgeParticipant({ ...empty, roles: [{ role: 'speaker' }, { role: 'adj-core' }] })).toBe(false);
  });

  test('judge role mixed with other roles still counts', () => {
    expect(
      isJudgeParticipant({ ...empty, roles: [{ role: 'speaker' }, { role: 'judge' }] }),
    ).toBe(true);
  });
});
