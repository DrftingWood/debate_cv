import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PLACEHOLDER_NAME_PATTERN,
  isPlaceholderPersonName,
  isRedactedName,
  stripAttendanceTag,
} from '@/lib/calicotab/names';

describe('placeholder names', () => {
  // From real speaker tabs in the corpus, or older normalisations of them.
  test.each([
    'Speaker 1',
    'speaker 2',
    'Speaker 31',
    'Speaker 2.2',
    'Speaker 1A',
    'Speaker 1 A',
    'Speaker 2b',
    'Speaker B',
    'Speaker II',
    'Speaker One',
    'Speaker',
    'Orador 1',
    'Orador C2',
    'Orador C 2',
    'Swing 2',
    'Swing A',
    'Swing Speaker 1',
    'Swing y 1',
    "Swing 1b (Please don't give speaker points)",
    'Swinging partner 1',
    'Swing mcswingface 2',
    'SwingB',
    'Iron 1',
    'Debater 1',
    'Judge 1',
    'Adjudicator 1',
    'Placeholder (do not assign a speaker score)',
    'Placeholder1',
    '<em>Redacted</em>',
    'Redacted 3',
    'REDACTED 5',
    'Anonymous',
    'Invalid',
    'TBC',
    'N/A',
    '4',
    '[o] Speaker 1',
  ])('%s is not a person', (name) => {
    expect(isPlaceholderPersonName(name)).toBe(true);
  });

  test.each([
    'Abhishek Acharya',
    'Weon Bin Na',
    'Eric Na',
    'chandler swing',
    'Speaker Pelosi',
    'Swingle Iron',
    'Ironside',
    'Shy',
    'Iron Ли',
    'Swing 张伟',
    '王欣月2',
    'Иван Петров 1',
    'Anonymous A',
  ])('%s is left alone', (name) => {
    expect(isPlaceholderPersonName(name)).toBe(false);
  });

  test('redacted renderings are recognised as such', () => {
    expect(isRedactedName('<em>Redacted</em>')).toBe(true);
    expect(isRedactedName('Anonymous')).toBe(true);
    expect(isRedactedName('Speaker 1')).toBe(false);
  });

  test('the cleanup migration uses exactly this pattern', () => {
    const sql = readFileSync(
      join(process.cwd(), 'prisma/migrations/20260915000000_remove_placeholder_persons/migration.sql'),
      'utf-8',
    );
    expect(sql).toContain(`'${PLACEHOLDER_NAME_PATTERN}'`);
    expect(sql).toContain('"suppressedAt" IS NULL');
    expect(sql).toContain(`"displayName" !~ '[^ -~]'`);
  });
});

describe('attendance tags', () => {
  test("a hybrid tournament's [o] / [i] tag is not part of the name", () => {
    expect(stripAttendanceTag('[o] Vladimira Suflaj')).toBe('Vladimira Suflaj');
    expect(stripAttendanceTag('[i] ANU 1')).toBe('ANU 1');
  });

  test('a bracketed whole name is not a tag', () => {
    expect(stripAttendanceTag('[REDACTED]')).toBe('[REDACTED]');
    expect(stripAttendanceTag('[o]')).toBe('[o]');
    expect(stripAttendanceTag('Plain Name')).toBe('Plain Name');
  });
});
