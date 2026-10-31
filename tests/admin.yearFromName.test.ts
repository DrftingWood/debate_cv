import { describe, expect, it } from 'vitest';
import { yearFromName } from '@/lib/admin/yearFromName';

// Fixed so the table does not change meaning when the calendar turns: the
// largest year read is 2027 (next year), the smallest two-digit one 2015.
const NOW = new Date('2026-10-31T00:00:00Z');

describe('yearFromName', () => {
  const table: Array<[string, number | null]> = [
    // a two-digit year stuck to a word, or after one
    ['Preworlds24', 2024],
    ['Vienna IV 24', 2024],
    ['ERR 26', 2026],
    ["Nationals '25", 2025],
    // a four-digit year
    ['WUDC 2023', 2023],
    ['Oxford IV 2019', 2019],
    ['Cambridge Open 2027', 2027],
    // the same year said twice is still one year
    ['WUDC 2023 (23)', 2023],
    // counts and ordinals are not years
    ['Round 16', null],
    ['Top 32', null],
    ['Top 24', null],
    ['Top-16', null],
    ['Round-16', null],
    ['R-16', null],
    ['Under-18', null],
    ['U-19', null],
    ['Division 20', null],
    ['Level 18', null],
    ['Week 24', null],
    ['Season 18', null],
    ['Edition 16', null],
    ['Class 16', null],
    ['Batch 21', null],
    ['24 Hour Debate', null],
    ['20 Years of X', null],
    ['24h', null],
    ['Open 24 teams', null],
    ['Under 18 Open', null],
    ['U19 Champs', null],
    ['16 teams invitational', null],
    ['21st Annual Cup', null],
    ['Asia 2 Open', null],
    // out of range
    ['Open 1999', null],
    ['Open 2031', null],
    ['Open 14', null],
    ['Open 28', null],
    // inside another figure
    ['Version 1.24 trial', null],
    ['Start 10:24', null],
    ['Ref 2024001', null],
    // seasons spanning two years, or two different years
    ['IV 2019-20', null],
    ['Cup 2019/2020', null],
    ['Cup 2019 - 2020', null],
    ['Open 2023 vs 2024', null],
    // nothing at all
    ['', null],
    ['test', null],
    ['Minimal8team', null],
  ];

  it.each(table)('%s -> %s', (name, year) => {
    expect(yearFromName(name, NOW)).toBe(year);
  });

  it('allows next year but not the one after', () => {
    expect(yearFromName('Open 27', NOW)).toBe(2027);
    expect(yearFromName('Open 28', NOW)).toBeNull();
  });
});
