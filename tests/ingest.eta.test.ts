import { describe, expect, it } from 'vitest';
import { estimateQueueSeconds } from '@/lib/ingest/eta';

const NOW = Date.parse('2026-10-30T18:00:00Z');
const minutesAgo = (m: number) => new Date(NOW - m * 60_000);

describe('estimateQueueSeconds', () => {
  it('uses the observed rate, not one job’s duration (production, 2026-10-30)', () => {
    // 145 queued; 66 finished over the last hour; the average successful job
    // took 2.8 s, mostly cache hits. The old answer was 145 × 2.8 = 403 s.
    const eta = estimateQueueSeconds({
      now: NOW,
      pending: 145,
      running: 0,
      finishedRecent: 66,
      firstStartedAt: minutesAgo(60),
      perJobSeconds: 2.8,
      currentElapsedSeconds: 0,
      latestScheduledAt: null,
    });
    expect(eta).toBeGreaterThan(7_500); // about 2.2 h
    expect(eta).toBeLessThan(8_500);
  });

  it('falls back to per-job time when too few jobs have finished to measure a rate', () => {
    const eta = estimateQueueSeconds({
      now: NOW,
      pending: 4,
      running: 0,
      finishedRecent: 2,
      firstStartedAt: minutesAgo(1),
      perJobSeconds: 10,
      currentElapsedSeconds: 0,
      latestScheduledAt: null,
    });
    expect(eta).toBe(40);
  });

  it('never ends before a retry that is scheduled for later', () => {
    const eta = estimateQueueSeconds({
      now: NOW,
      pending: 1,
      running: 0,
      finishedRecent: 0,
      firstStartedAt: null,
      perJobSeconds: 10,
      currentElapsedSeconds: 0,
      latestScheduledAt: new Date(NOW + 3_600_000),
    });
    expect(eta).toBeGreaterThanOrEqual(3_600);
  });

  it('is null when nothing is queued or running', () => {
    expect(
      estimateQueueSeconds({
        now: NOW,
        pending: 0,
        running: 0,
        finishedRecent: 9,
        firstStartedAt: minutesAgo(30),
        perJobSeconds: 10,
        currentElapsedSeconds: 0,
        latestScheduledAt: null,
      }),
    ).toBeNull();
  });
});
