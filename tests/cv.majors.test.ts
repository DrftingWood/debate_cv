import { describe, expect, test } from 'vitest';
import { MAJORS, PRESTIGIOUS_BY_REGION, majorFor, isMajor } from '@/lib/cv/majors';

// Owner decision C21 (2026-10-27): one editable list replaces the old regex.
const OLD_PATTERN =
  /\b(?:wudc|world(?: university)? debating|eudc|european debating|australs|asian debating|naudc|north american debating)\b/i;

describe('majors list (C21)', () => {
  test('is exactly the owner list, in order', () => {
    expect(MAJORS.map((m) => m.id)).toEqual([
      'WUDC',
      'ABP',
      'EUDC',
      'Australs',
      'UADC',
      'PAUDC',
      'USUDC',
      'NAUDC',
    ]);
  });

  test.each([
    ['WUDC 2025', 'WUDC'],
    ['World Universities Debating Championship 2024', 'WUDC'],
    ['World University Debating Championship', 'WUDC'],
    ['Worlds 2024', 'WUDC'],
    ['Asian BP 2024', 'ABP'],
    ['Asian British Parliamentary Championship', 'ABP'],
    ['EUDC 2024', 'EUDC'],
    ['European Universities Debating Championship', 'EUDC'],
    ['Australs 2024', 'Australs'],
    ['Australasian Intervarsity Debating Championships', 'Australs'],
    ['United Asian Debating Championship', 'UADC'],
    ['UADC 2025', 'UADC'],
    ['PAUDC 2024', 'PAUDC'],
    ['USUDC 2025', 'USUDC'],
    ['NAUDC 2024', 'NAUDC'],
    ['North American Universities Debating Championship', 'NAUDC'],
  ])('%s is a major (%s)', (name, id) => {
    expect(majorFor(name)?.id).toBe(id);
    expect(isMajor(name)).toBe(true);
  });

  test.each([
    ['Pan-African Universities Debating Championship', 'PAUDC'],
    ['US Universities Debating Championship', 'USUDC'],
    ['Asian Universities Debating Championship', 'ABP'],
    ['AUDC 2012', 'ABP'],
  ])('%s is a major (%s)', (name, id) => {
    expect(majorFor(name)?.id).toBe(id);
  });

  test.each([
    'Pre-Worlds 2024',
    'Novice Worlds',
    'Junior Worlds',
    'Schools Worlds',
    'Mini-Worlds',
    'Worlds Masters',
    'World Debating Forum',
    'Worlds Schools Debating Championship',
    'Junior Australs',
    'Pre-Australs',
    'South East Asian Debating Championship',
  ])('"%s" is not a major', (name) => {
    expect(isMajor(name)).toBe(false);
  });

  test.each([
    'Korea WUDC 2021',
    'Belgrade Worlds 2022',
    'Madrid 2023',
    'Hanoi 2024',
    'Vietnam Worlds 2024',
    'Panama 2025',
    'Sofia 2026',
    'Ho Chi Minh 2024',
  ])('host-named "%s" is WUDC', (name) => {
    expect(majorFor(name)?.id).toBe('WUDC');
  });

  test.each([
    'North American Debating Championship',
    'Madrid Open 2023',
    'Korea Open 2021',
    'Madrid 2022',
    'Sofia IV 2026',
    'Panama',
    'Pre-Worlds Madrid 2023',
    'Novice Madrid 2023',
  ])('"%s" is not WUDC', (name) => {
    expect(isMajor(name)).toBe(false);
  });

  test.each(['World Schools Debating Championships', 'Hart House IV 2023', 'Oxford IV', ''])(
    '"%s" is not a major',
    (name) => {
      expect(isMajor(name)).toBe(false);
    },
  );

  test('tournaments whose majors status changes versus the old regex', () => {
    const names = [
      'WUDC 2025',
      'Australs 2024',
      'United Asian Debating Championship',
      'World University Debating Championship',
      'EUDC 2024',
      'World Universities Debating Championship 2024',
      'Worlds 2024',
      'European Universities Debating Championship',
      'Australasian Intervarsity Debating Championships',
      'North American Universities Debating Championship',
      'PAUDC 2024',
      'Asian BP 2024',
      'USUDC 2025',
      'UADC 2025',
      'World Schools Debating Championships',
    ];
    const gained = names.filter((n) => isMajor(n) && !OLD_PATTERN.test(n));
    const lost = names.filter((n) => !isMajor(n) && OLD_PATTERN.test(n));
    expect(gained).toEqual([
      'World Universities Debating Championship 2024',
      'Worlds 2024',
      'European Universities Debating Championship',
      'Australasian Intervarsity Debating Championships',
      'North American Universities Debating Championship',
      'PAUDC 2024',
      'Asian BP 2024',
      'USUDC 2025',
      'UADC 2025',
    ]);
    expect(lost).toEqual([]);
  });

  test('the prestigious-by-region extension point exists and is empty', () => {
    expect(PRESTIGIOUS_BY_REGION).toEqual({});
  });
});
