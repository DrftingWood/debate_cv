import { describe, expect, test } from 'vitest';
import {
  classifyCoreRole,
  coreJudgingBreak,
  coreUsuallyJudges,
  isAdjudicationCoreRole,
} from '@/lib/calicotab/judgeStats';
import { parseParticipantsList } from '@/lib/calicotab/parseTabs';

// Owner rules (assumptions I20, ingest Q13, 2026-10-27): Chief Adjudicators
// usually judge, Tab Directors usually do not, a TD who does judge counts as
// a judging break, and technically a judging CA does too.

describe('classifyCoreRole', () => {
  test('tells the Tab Director from the Chief Adjudicator', () => {
    expect(classifyCoreRole('Tab Director')).toBe('tab_director');
    expect(classifyCoreRole('tab-director')).toBe('tab_director');
    expect(classifyCoreRole('Chief Adjudicator')).toBe('chief_adjudicator');
    expect(classifyCoreRole('Deputy Chief Adjudicator')).toBe('chief_adjudicator');
    expect(classifyCoreRole('CA')).toBe('chief_adjudicator');
    expect(classifyCoreRole('DCA')).toBe('chief_adjudicator');
    expect(classifyCoreRole('Adj Core')).toBe('adj_core');
  });

  test('a person who is both is read as the one who judges', () => {
    expect(classifyCoreRole('Tab Director and Chief Adjudicator')).toBe('chief_adjudicator');
  });

  test('ordinary judges and names like Cameron are not core', () => {
    expect(classifyCoreRole('Adjudicator')).toBeNull();
    expect(classifyCoreRole('Independent adjudicator')).toBeNull();
    expect(classifyCoreRole('Cameron')).toBeNull();
    expect(isAdjudicationCoreRole('Cameron')).toBe(false);
    expect(isAdjudicationCoreRole('Chief Adjudicator')).toBe(true);
  });
});

describe('coreUsuallyJudges', () => {
  test('CAs and the adj core do; Tab Directors do not', () => {
    expect(coreUsuallyJudges('chief_adjudicator')).toBe(true);
    expect(coreUsuallyJudges('adj_core')).toBe(true);
    expect(coreUsuallyJudges('tab_director')).toBe(false);
    expect(coreUsuallyJudges(null)).toBe(false);
  });
});

describe('coreJudgingBreak', () => {
  test('a core member who judged any round has a judging break', () => {
    expect(coreJudgingBreak('core', true)).toBe(true);
  });

  test('a core member who never judged does not, and nor does anyone else', () => {
    expect(coreJudgingBreak('core', false)).toBe(false);
    expect(coreJudgingBreak('normal', true)).toBe(false);
    expect(coreJudgingBreak(null, true)).toBe(false);
  });
});

describe('participant role text', () => {
  const page = (role: string) =>
    `<html><body><div class="list-group"><div class="card-title">Registration (Sam Tab)</div><ul><li>${role}</li></ul></div></body></html>`;

  test('the stored shape is unchanged: a Tab Director is still a core adjudicator row', () => {
    const [row] = parseParticipantsList(page('Tab Director'));
    expect(row).toMatchObject({ role: 'adjudicator', judgeTag: 'core' });
  });
});
