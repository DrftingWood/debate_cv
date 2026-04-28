import { describe, expect, test } from 'vitest';
import {
  computeFingerprint,
  extractYearFromName,
  normalizePersonName,
} from '@/lib/calicotab/fingerprint';

describe('computeFingerprint', () => {
  test('is stable across equivalent inputs', () => {
    const a = computeFingerprint({
      host: 'Wudc2024.calicotab.com',
      tournamentSlug: 'WUDC2024',
      tournamentName: ' World Universities Debating Championship 2024 ',
      year: 2024,
    });
    const b = computeFingerprint({
      host: 'wudc2024.calicotab.com',
      tournamentSlug: 'wudc2024',
      tournamentName: 'world universities debating championship 2024',
      year: 2024,
    });
    expect(a).toBe(b);
  });

  test('differs on different tournaments', () => {
    const a = computeFingerprint({ host: 'a.calicotab.com', tournamentSlug: 'a', tournamentName: 'A', year: 2024 });
    const b = computeFingerprint({ host: 'b.calicotab.com', tournamentSlug: 'b', tournamentName: 'B', year: 2024 });
    expect(a).not.toBe(b);
  });
});

describe('extractYearFromName', () => {
  test('finds 4-digit year in name', () => {
    expect(extractYearFromName('WUDC 2024 Vietnam')).toBe(2024);
    expect(extractYearFromName('ILNU RR 2026')).toBe(2026);
    expect(extractYearFromName('No year here')).toBe(null);
  });
});

describe('normalizePersonName', () => {
  test('lowercases and strips punctuation/whitespace', () => {
    expect(normalizePersonName('  Abhishek  Acharya ')).toBe('abhishek acharya');
    expect(normalizePersonName("Méline O'Brien")).toBe('mline obrien');
  });

  test('treats hyphens / underscores / periods / slashes as word separators', () => {
    // Previously `[-_./\\]` were stripped wholesale, collapsing
    // "Abhishek-Acharya" → "abhishekacharya" and breaking matching
    // against the canonical "abhishek acharya" form.
    expect(normalizePersonName('Abhishek-Acharya')).toBe('abhishek acharya');
    expect(normalizePersonName('abhishek_acharya')).toBe('abhishek acharya');
    expect(normalizePersonName('Abhishek.Acharya')).toBe('abhishek acharya');
    expect(normalizePersonName('Acharya/Abhishek')).toBe('acharya abhishek');
  });
});
