import { describe, expect, test } from 'vitest';
import { candidateFingerprints, computeFingerprint } from '@/lib/calicotab/fingerprint';

const base = {
  host: 'example.calicotab.com',
  tournamentSlug: 'autumnnovice',
  tournamentName: 'Autumn Novice',
};
const fp = (year: number | null) => computeFingerprint({ ...base, year });

describe('candidateFingerprints', () => {
  test('explicit year in the name yields exactly one candidate', () => {
    // "Oxford IV 2024" and "Oxford IV 2025" are different events — no
    // neighbouring-year probing allowed when the year is authoritative.
    const named = { ...base, tournamentName: 'Autumn Novice 2025' };
    expect(
      candidateFingerprints({ ...named, explicitYear: 2025, inferredYear: 2025 }),
    ).toEqual([computeFingerprint({ ...named, year: 2025 })]);
  });

  test('inferred year probes the inferred value, null, and both neighbours in order', () => {
    expect(
      candidateFingerprints({ ...base, explicitYear: null, inferredYear: 2025 }),
    ).toEqual([fp(2025), fp(null), fp(2024), fp(2026)]);
  });

  test('the year-boundary case converges: Dec-2024 email finds the row a Jan-2025 email stored', () => {
    const decemberUser = candidateFingerprints({ ...base, explicitYear: null, inferredYear: 2024 });
    const januaryUser = candidateFingerprints({ ...base, explicitYear: null, inferredYear: 2025 });
    // Each user's candidate list contains the other's primary fingerprint,
    // so whichever ingests first, the second finds the existing row.
    expect(decemberUser).toContain(januaryUser[0]);
    expect(januaryUser).toContain(decemberUser[0]);
  });

  test('no year information at all yields only the null-year fingerprint', () => {
    expect(
      candidateFingerprints({ ...base, explicitYear: null, inferredYear: null }),
    ).toEqual([fp(null)]);
  });
});
