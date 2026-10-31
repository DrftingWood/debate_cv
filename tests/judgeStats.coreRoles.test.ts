import { describe, expect, test } from 'vitest';
import {
  classifyCoreRole,
  coreJudgingBreak,
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

  test.each([
    ['CAP', 'chief_adjudicator'],
    ['DCAP', 'chief_adjudicator'],
    ['CAs', 'chief_adjudicator'],
    ['Deputy CAs', 'chief_adjudicator'],
    ['Chief Adjudication Panel', 'chief_adjudicator'],
    ['Chief Adjudicator Panel', 'chief_adjudicator'],
    ['Deputy Chief Adjudicators', 'chief_adjudicator'],
    ['Adj. Core', 'adj_core'],
    ['Adj-Core', 'adj_core'],
    ['Adjudication Core', 'adj_core'],
    ['Adjudicator Core', 'adj_core'],
    ['Core Adj', 'adj_core'],
    ['Core Adjudicators', 'adj_core'],
    ['Tab Directors', 'tab_director'],
  ])('reads the hand-typed spelling %s as core', (text, kind) => {
    expect(classifyCoreRole(text)).toBe(kind);
  });

  test('words that merely contain the letters are not core', () => {
    for (const t of [
      'Captain',
      'Capetown',
      'Equity',
      'Casey',
      'Adjudicator',
      'Hardcore adjudicator',
    ])
      expect(classifyCoreRole(t)).toBeNull();
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
