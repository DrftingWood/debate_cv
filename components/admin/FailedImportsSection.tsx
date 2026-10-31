import { FailedJobsTable, type FailedJobRow } from '@/components/admin/FailedJobsTable';
import type { ScrapeHealth } from '@/lib/admin/scrapeHealth';
import { ingestErrorCategory } from '@/lib/ingest/userMessage';
import { relativeTime } from '@/lib/utils/relativeTime';
import { shortUrl } from '@/lib/utils/shortUrl';
import { publicPieceUrl } from '@/lib/audit/types';
import { inDatabase } from '@/components/admin/InDatabaseCell';
import type { Priority } from '@/lib/admin/reviewSetTypes';

const ERROR_CHARS = 80;

/**
 * Server side of "Failed imports": turns each job into a row the client
 * table can show as it is. `lastError` is a scraper exception, often with a
 * URL and a stack-like suffix, so the row carries what it means instead
 * (UX-23), capped so the Error column stays one or two lines; the URL loses
 * its private key; the time is put into words against the page's clock.
 * `flagged` holds the jobs with an open review-set flag, by job id, for the
 * row's "Flagged · High" badge.
 */
export function toFailedJobRows(
  jobs: ScrapeHealth['failedJobs'],
  now: Date,
  flagged: ReadonlyMap<string, Priority> = new Map(),
): FailedJobRow[] {
  return jobs.map((j) => {
    const words = j.lastError ? ingestErrorCategory(j.lastError) : null;
    return {
      id: j.id,
      user: j.userEmail,
      url: shortUrl(j.url),
      href: publicPieceUrl(j.url),
      attempts: j.attempts,
      error:
        words && words.length > ERROR_CHARS
          ? `${words.slice(0, ERROR_CHARS - 1).trimEnd()}…`
          : words,
      when: j.finishedAt
        ? { text: relativeTime(j.finishedAt, now), iso: j.finishedAt.toISOString() }
        : null,
      stored: inDatabase(j.stored, now),
      tab: j.tab,
      flag: flagged.has(j.id) ? { priority: flagged.get(j.id)! } : null,
    };
  });
}

export function FailedImportsSection({
  jobs,
  total,
  now,
  flagged,
}: {
  jobs: ScrapeHealth['failedJobs'];
  total: number;
  now: Date;
  flagged?: ReadonlyMap<string, Priority>;
}) {
  return (
    <section aria-labelledby="failed-imports" className="space-y-stack rounded-lg border p-panel">
      <div>
        <h2 id="failed-imports" className="font-display text-h3 font-medium text-ink">
          Failed imports
        </h2>
        <p className="mt-hair text-body text-ink-soft">
          Imports that failed on every attempt. Retrying puts them back on the queue; locked URLs
          are left alone. Tab says how much of the tournament is stored; add the ones to look at
          closely to the review set below.
        </p>
      </div>
      <FailedJobsTable rows={toFailedJobRows(jobs, now, flagged)} total={total} />
    </section>
  );
}
