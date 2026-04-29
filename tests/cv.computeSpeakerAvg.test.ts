import { describe, expect, test } from 'vitest';
import { computeSpeakerAvg } from '@/lib/cv/computeSpeakerAvg';

/**
 * Pure helper extracted from buildCvData so the four resolution paths
 * (explicit Average cell → total/prelimsSpoken → mean of round cells →
 * AP-fallback total/prelimRoundCount) can be exercised without mocking
 * the entire CV-build query surface.
 *
 * The audit follow-up flagged that the AP fallback (path 4) had no test
 * coverage; this file fills that gap and locks in the priority order.
 */
describe('computeSpeakerAvg', () => {
  test('prefers the explicit Average cell when provided', () => {
    expect(
      computeSpeakerAvg({
        averageCellScore: 76.5,
        numericScores: [],
        speakerScoreTotal: 999,
        prelimRoundCount: 3,
      }),
    ).toBe('76.5');
  });

  test('uses speakerScoreTotal / prelimsSpoken when both are known', () => {
    // 320 / 4 rounds = 80.0 — the BP and AP-with-per-round-columns path.
    expect(
      computeSpeakerAvg({
        averageCellScore: null,
        numericScores: [78, 80, 82, 80],
        speakerScoreTotal: 320,
        prelimRoundCount: 5, // ignored; prelimsSpoken wins
      }),
    ).toBe('80.0');
  });

  test('falls back to mean of per-round cells when total is unknown', () => {
    expect(
      computeSpeakerAvg({
        averageCellScore: null,
        numericScores: [75, 76, 77],
        speakerScoreTotal: null,
        prelimRoundCount: null,
      }),
    ).toBe('76.0');
  });

  test('AP fallback: total / prelimRoundCount when no per-round data exists', () => {
    // The exact case the user reported in the original CSV: AP tournaments
    // (NLSD 2025, SRDF 2024, CUPD 2022, etc.) where the speaker tab gives
    // only `total` plus rank, and per-round columns are missing entirely.
    // Tournament.prelimRoundCount comes from the landing nav at ingest.
    expect(
      computeSpeakerAvg({
        averageCellScore: null,
        numericScores: [],
        speakerScoreTotal: 379,
        prelimRoundCount: 5,
      }),
    ).toBe('75.8');
  });

  test('returns null when nothing is known', () => {
    expect(
      computeSpeakerAvg({
        averageCellScore: null,
        numericScores: [],
        speakerScoreTotal: null,
        prelimRoundCount: null,
      }),
    ).toBeNull();
  });

  test('returns null when total exists but prelimRoundCount is 0 or null', () => {
    // Without a divisor we cannot honestly produce an average — better to
    // surface "—" on the CV than to invent a number.
    expect(
      computeSpeakerAvg({
        averageCellScore: null,
        numericScores: [],
        speakerScoreTotal: 379,
        prelimRoundCount: 0,
      }),
    ).toBeNull();
    expect(
      computeSpeakerAvg({
        averageCellScore: null,
        numericScores: [],
        speakerScoreTotal: 379,
        prelimRoundCount: null,
      }),
    ).toBeNull();
  });

  test('rejects non-finite explicit Average value but still tries other paths', () => {
    expect(
      computeSpeakerAvg({
        averageCellScore: NaN,
        numericScores: [78, 80],
        speakerScoreTotal: 158,
        prelimRoundCount: null,
      }),
    ).toBe('79.0');
  });
});
