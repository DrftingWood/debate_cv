import { relativeTime } from '@/lib/utils/relativeTime';

/**
 * "Re-ingest all" cannot null `scrapedAt` (the column is required), so it
 * writes the epoch to say "scrape this again". Shown as a date that read
 * "1 Jan 1970" (owner, 2026-10-31). Nothing real is scraped before 2000, so
 * anything earlier is the marker, not a time.
 */
const MARKER_CUTOFF = Date.UTC(2000, 0, 1);

export function isEpochMarker(date: Date): boolean {
  return date.getTime() < MARKER_CUTOFF;
}

/** What a scrape time says on screen: the marker is a queued re-scrape, else relative time. */
export function scrapedLabel(date: Date, now: Date): string {
  return isEpochMarker(date) ? 'Re-scrape queued' : relativeTime(date, now);
}

/**
 * The label plus its machine-readable date for a <time>. The marker has no
 * date to give (its ISO form is the very "1970" this exists to hide), so
 * `iso` is null and the caller renders plain text.
 */
export function scrapedStamp(date: Date, now: Date): { text: string; iso: string | null } {
  return { text: scrapedLabel(date, now), iso: isEpochMarker(date) ? null : date.toISOString() };
}
