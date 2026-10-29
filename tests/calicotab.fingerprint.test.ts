import { describe, expect, test } from 'vitest';
import {
  computeFingerprint,
  extractYearFromName,
  inferTournamentYear,
  normalizePersonName,
  normalizePersonNameV2,
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
    const a = computeFingerprint({
      host: 'a.calicotab.com',
      tournamentSlug: 'a',
      tournamentName: 'A',
      year: 2024,
    });
    const b = computeFingerprint({
      host: 'b.calicotab.com',
      tournamentSlug: 'b',
      tournamentName: 'B',
      year: 2024,
    });
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

describe('inferTournamentYear', () => {
  test('prefers explicit year in tournament name', () => {
    expect(inferTournamentYear('WUDC 2024', new Date('2025-02-01T00:00:00Z'))).toBe(2024);
  });

  test('falls back to messageDate year when name has no year', () => {
    expect(inferTournamentYear('Novice Open', new Date('2025-11-03T10:30:00Z'))).toBe(2025);
  });

  test('returns null when neither source has a year', () => {
    expect(inferTournamentYear('No year here', null)).toBeNull();
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

// Name key v2 (identity option B, phase 1). v1's tests above are unchanged:
// v1 stays the bucket key until phase 7.
describe('normalizePersonNameV2', () => {
  test('folds accents instead of deleting the letter', () => {
    expect(normalizePersonNameV2('José Álvarez')).toBe('jose alvarez');
    expect(normalizePersonNameV2('Méline Dupré')).toBe('meline dupre');
    expect(normalizePersonName('José')).toBe('jos'); // the v1 loss v2 exists to fix
  });

  test('spells out Latin letters that carry no mark to drop', () => {
    expect(normalizePersonNameV2('Nguyễn Văn Đức')).toBe('nguyen van duc');
    expect(normalizePersonNameV2('Łukasz Żółć')).toBe('lukasz zolc');
    expect(normalizePersonNameV2('Bjørn Ærø')).toBe('bjorn aero');
    expect(normalizePersonNameV2('Işık Strauß')).toBe('isik strauss');
  });

  test('keeps letters of every script', () => {
    expect(normalizePersonNameV2('Иван Петров')).toBe('иван петров');
    expect(normalizePersonNameV2('अभिषेक आचार्य')).not.toBe('');
    expect(normalizePersonNameV2('王伟')).toBe('王伟');
    expect(normalizePersonName('王伟')).toBe(''); // v1 empties it
  });

  test("keeps v1's separators and drops other punctuation", () => {
    expect(normalizePersonNameV2('Abhishek-Acharya')).toBe('abhishek acharya');
    expect(normalizePersonNameV2('abhishek_acharya')).toBe('abhishek acharya');
    expect(normalizePersonNameV2("O'Brien, Seán")).toBe('obrien sean');
    expect(normalizePersonNameV2('  Abhishek    Acharya ')).toBe('abhishek acharya');
  });

  test('unpacks compatibility forms (ligatures, full-width letters)', () => {
    expect(normalizePersonNameV2('Ｊｏｈｎ Ｓｍｉｔｈ')).toBe('john smith');
    expect(normalizePersonNameV2('ﬁona')).toBe('fiona');
  });

  test('is empty only for input with no letters or digits', () => {
    expect(normalizePersonNameV2('— . —')).toBe('');
    expect(normalizePersonNameV2('')).toBe('');
  });

  test('agrees with v1 on plain ASCII names', () => {
    for (const n of ['Abhishek Acharya', 'priya-rao', 'Team 3 Swing', 'A. K. Sen'])
      expect(normalizePersonNameV2(n)).toBe(normalizePersonName(n));
  });
});
