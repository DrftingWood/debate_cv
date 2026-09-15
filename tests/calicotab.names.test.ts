import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PLACEHOLDER_NAME_PATTERN,
  isPlaceholderPersonName,
  stripAttendanceTag,
} from '@/lib/calicotab/names';

describe('placeholder names', () => {
  // Every shape below is from a real speaker tab in the corpus.
  test.each([
    'Speaker 1',
    'speaker 2',
    'Speaker 31',
    'Speaker 2.2',
    'Speaker 1A',
    'Speaker 2b',
    'Speaker B',
    'Speaker',
    'Orador 1',
    'Orador C2',
    'Swing 2',
    'Swing A',
    'Iron 1',
    'Debater 1',
    'Placeholder (do not assign a speaker score)',
    'Invalid',
    '4',
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
    '<em>Redacted</em>',
  ])('%s is left alone', (name) => {
    expect(isPlaceholderPersonName(name)).toBe(false);
  });

  test('the cleanup migration uses exactly this pattern', () => {
    const sql = readFileSync(
      join(process.cwd(), 'prisma/migrations/20260915000000_remove_placeholder_persons/migration.sql'),
      'utf-8',
    );
    expect(sql).toContain(`'${PLACEHOLDER_NAME_PATTERN}'`);
  });
});

describe('attendance tags', () => {
  test('a hybrid tournament\'s [o] / [i] tag is not part of the name', () => {
    expect(stripAttendanceTag('[o] Vladimira Suflaj')).toBe('Vladimira Suflaj');
    expect(stripAttendanceTag('[i] ANU 1')).toBe('ANU 1');
  });

  test('a bracketed whole name is not a tag', () => {
    expect(stripAttendanceTag('[REDACTED]')).toBe('[REDACTED]');
    expect(stripAttendanceTag('[o]')).toBe('[o]');
    expect(stripAttendanceTag('Plain Name')).toBe('Plain Name');
  });
});
