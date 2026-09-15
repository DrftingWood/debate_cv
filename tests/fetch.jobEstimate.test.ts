import { describe, expect, test } from 'vitest';
import { FETCH_MIN_INTERVAL_MS, estimateIngestMs } from '@/lib/calicotab/fetch';

describe('estimateIngestMs', () => {
  test('reproduces the documented 40s figure at the old 1500ms floor', () => {
    // The drain route's ESTIMATED_JOB_MS was hand-derived as
    //   ~16 same-host fetches x 1.5s = 24s
    //   + fetch latency (~0.3s x 16)  = ~5s
    //   + parse + bulk DB writes      = ~10s
    // Pinning that here proves the formula is the same arithmetic, not a
    // new guess, before anything starts depending on it. 38.8s rather than
    // the comment's 40s only because the comment rounded 16 x 0.3s up to 5s.
    expect(estimateIngestMs(1500)).toBe(38_800);
  });

  test('tracks the interval down, so the budget stops over-reserving', () => {
    // The whole point: the floor moved to 600ms but the 40s reservation
    // did not, so a drain refused to start jobs it had time for.
    expect(estimateIngestMs(600)).toBe(24_400);
    expect(estimateIngestMs(400)).toBe(21_200);
  });

  test('is monotonic in the interval', () => {
    expect(estimateIngestMs(300)).toBeLessThan(estimateIngestMs(600));
    expect(estimateIngestMs(600)).toBeLessThan(estimateIngestMs(1500));
  });

  test('exports the configured floor for callers that budget against it', () => {
    expect(FETCH_MIN_INTERVAL_MS).toBeGreaterThan(0);
    expect(Number.isFinite(FETCH_MIN_INTERVAL_MS)).toBe(true);
  });
});
