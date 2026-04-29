import { describe, expect, test } from 'vitest';
import { findRedactedOwnerRow } from '@/lib/calicotab/redactedSpeaker';
import type { SpeakerTabRow } from '@/lib/calicotab/parseTabs';

/**
 * Owner-row fallback for redacted speaker names. NUJS PD 2023 reproduced
 * the case: the user's name was hidden from the public speaker tab, so
 * the regular name-based upsert path skipped their row and their CV
 * surfaced no rank / average / round scores for the tournament. Helper
 * resolves it by team-anchoring: when the registration card knows the
 * owner's team and exactly one row on that team isn't matchable by name,
 * that row is the owner's.
 */

function row(overrides: Partial<SpeakerTabRow>): SpeakerTabRow {
  return {
    rank: null,
    rankEsl: null,
    rankEfl: null,
    speakerName: 'Some Name',
    teamName: null,
    institution: null,
    totalScore: null,
    roundScores: [],
    ...overrides,
  };
}

function makeLookup(map: Record<string, bigint>): (n: string) => bigint | null {
  return (n: string) => (n in map ? map[n]! : null);
}

describe('findRedactedOwnerRow', () => {
  test('attributes the unique unmatched row in the owner team to the owner', () => {
    const speakerRows = [
      row({ speakerName: 'Riya Bhar', teamName: 'NUJS A' }),
      row({ speakerName: 'Anonymous', teamName: 'NUJS A' }),
      row({ speakerName: 'Other Speaker', teamName: 'Hidayatullah A' }),
    ];
    const lookup = makeLookup({
      'Riya Bhar': 11n,
      'Other Speaker': 12n,
      'Anya Yuk Lan': 13n, // owner pre-committed but not in tab
    });

    const got = findRedactedOwnerRow(speakerRows, 'Anya Yuk Lan', 'NUJS A', lookup);
    expect(got).toBe(speakerRows[1]);
  });

  test('returns null when the owner is already named in their team', () => {
    const speakerRows = [
      row({ speakerName: 'Anya Yuk Lan', teamName: 'NUJS A' }),
      row({ speakerName: 'Riya Bhar', teamName: 'NUJS A' }),
    ];
    const lookup = makeLookup({
      'Anya Yuk Lan': 13n,
      'Riya Bhar': 11n,
    });
    expect(findRedactedOwnerRow(speakerRows, 'Anya Yuk Lan', 'NUJS A', lookup)).toBeNull();
  });

  test('returns null when two+ rows on the team are unmatched (ambiguous)', () => {
    // Team has two unrecognised speakers — we can't pick the owner
    // without more signal, so we abstain.
    const speakerRows = [
      row({ speakerName: 'Anonymous A', teamName: 'NUJS A' }),
      row({ speakerName: 'Anonymous B', teamName: 'NUJS A' }),
    ];
    const lookup = makeLookup({ 'Anya Yuk Lan': 13n });
    expect(findRedactedOwnerRow(speakerRows, 'Anya Yuk Lan', 'NUJS A', lookup)).toBeNull();
  });

  test('returns null when the team has no rows at all', () => {
    const speakerRows = [row({ speakerName: 'Other', teamName: 'Some Other Team' })];
    const lookup = makeLookup({ 'Other': 1n, 'Anya Yuk Lan': 13n });
    expect(findRedactedOwnerRow(speakerRows, 'Anya Yuk Lan', 'NUJS A', lookup)).toBeNull();
  });

  test('returns null when registration is missing name or team', () => {
    const speakerRows = [
      row({ speakerName: 'Riya Bhar', teamName: 'NUJS A' }),
      row({ speakerName: 'Anonymous', teamName: 'NUJS A' }),
    ];
    const lookup = makeLookup({ 'Riya Bhar': 11n, 'Anya Yuk Lan': 13n });
    expect(findRedactedOwnerRow(speakerRows, null, 'NUJS A', lookup)).toBeNull();
    expect(findRedactedOwnerRow(speakerRows, 'Anya Yuk Lan', null, lookup)).toBeNull();
    expect(findRedactedOwnerRow(speakerRows, '', 'NUJS A', lookup)).toBeNull();
  });

  test('returns null when the owner Person has not been pre-committed', () => {
    // Without an owner Person ID we have no person to attribute the
    // row to. Caller's pre-commit already adds the registration name,
    // but if for some reason it didn't, the helper bails out cleanly.
    const speakerRows = [
      row({ speakerName: 'Riya Bhar', teamName: 'NUJS A' }),
      row({ speakerName: 'Anonymous', teamName: 'NUJS A' }),
    ];
    const lookup = makeLookup({ 'Riya Bhar': 11n });
    expect(findRedactedOwnerRow(speakerRows, 'Anya Yuk Lan', 'NUJS A', lookup)).toBeNull();
  });

  test('only the owner team is considered — unmatched rows on other teams are irrelevant', () => {
    const speakerRows = [
      row({ speakerName: 'Riya Bhar', teamName: 'NUJS A' }),
      row({ speakerName: 'Anonymous', teamName: 'NUJS A' }),
      // Two unmatched rows on a different team should not affect the
      // ambiguity check, which is scoped to the owner's team only.
      row({ speakerName: 'Anon X', teamName: 'Hidayatullah A' }),
      row({ speakerName: 'Anon Y', teamName: 'Hidayatullah A' }),
    ];
    const lookup = makeLookup({ 'Riya Bhar': 11n, 'Anya Yuk Lan': 13n });
    const got = findRedactedOwnerRow(speakerRows, 'Anya Yuk Lan', 'NUJS A', lookup);
    expect(got).toBe(speakerRows[1]);
  });
});
