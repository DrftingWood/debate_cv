import { describe, expect, it } from 'vitest';
import { isEpochMarker, scrapedLabel, scrapedStamp } from '@/lib/utils/scrapedLabel';

// "Re-ingest all" sets a tournament's scrapedAt to the epoch so the next
// drain re-reads it; shown as a date it read "1 Jan 1970" (owner, 2026-10-31).

const NOW = new Date('2026-10-31T12:00:00Z');

describe('scrapedLabel', () => {
  it('names the epoch marker a queued re-scrape', () => {
    expect(scrapedLabel(new Date(0), NOW)).toBe('Re-scrape queued');
    expect(scrapedLabel(new Date('1999-12-31T23:59:59Z'), NOW)).toBe('Re-scrape queued');
  });

  it('gives a real scrape time as relative time', () => {
    expect(scrapedLabel(new Date('2026-10-31T10:00:00Z'), NOW)).toBe('2 h ago');
    expect(scrapedLabel(new Date('2000-01-01T00:00:00Z'), NOW)).not.toBe('Re-scrape queued');
  });

  it('knows the marker, and gives it no machine-readable date', () => {
    expect(isEpochMarker(new Date(0))).toBe(true);
    expect(isEpochMarker(new Date('2025-01-01'))).toBe(false);
    expect(scrapedStamp(new Date(0), NOW)).toEqual({ text: 'Re-scrape queued', iso: null });
    const real = new Date('2026-10-31T11:55:00Z');
    expect(scrapedStamp(real, NOW)).toEqual({ text: '5 min ago', iso: real.toISOString() });
  });
});
