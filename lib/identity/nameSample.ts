import { normalizePersonName } from '@/lib/calicotab/fingerprint';

/**
 * Who the user is, decided from a sample of their private-URL pages (owner
 * decisions, 2026-10-30).
 *
 * Each private-URL page names the person it was issued to. Onboarding reads
 * at least NAME_SAMPLE_MIN of the user's pages (all of them if they have
 * fewer) and takes the majority name: 9 pages saying "Abhishek Acharya" and 1
 * saying "Priya Raman" means the user is Abhishek and the odd one is a
 * forwarded link. Without a majority after NAME_SAMPLE_MIN, reading goes on
 * to NAME_SAMPLE_MAX; still split, every name is offered un-ticked and the
 * user chooses. The rest of the user's links are not read at this step: the
 * import step finds the user in each stored tournament by the names they
 * confirm (lib/calicotab/storedFirst.ts).
 */
export const NAME_SAMPLE_MIN = 10;
export const NAME_SAMPLE_MAX = 20;

/**
 * Written on a link onboarding did not need to read, once the sample decided
 * the name. Distinct from a failed read, which carries the failure reason.
 */
export const PREFLIGHT_SKIPPED = 'not read: your name was settled from your other links';

export type NameSample = {
  /** Pages read so far that named someone. */
  read: number;
  /** The most frequent name (first-seen spelling), or null with none read. */
  topName: string | null;
  /** Its share of the pages read, 0..1. */
  topShare: number;
  /** More than half of the pages read name the same person. */
  hasMajority: boolean;
  /** Enough has been read: stop reading pages. */
  complete: boolean;
  /** Pages still to read before the sample can complete. */
  need: number;
};

/** The sample so far, from the names already read off private-URL pages. */
export function nameSample(names: ReadonlyArray<string | null | undefined>): NameSample {
  const counts = new Map<string, { display: string; count: number }>();
  let read = 0;
  for (const raw of names) {
    const display = (raw ?? '').trim();
    const norm = display ? normalizePersonName(display) : '';
    if (!norm) continue;
    read += 1;
    const entry = counts.get(norm);
    if (entry) entry.count += 1;
    else counts.set(norm, { display, count: 1 });
  }
  let top: { display: string; count: number } | null = null;
  for (const entry of counts.values()) if (!top || entry.count > top.count) top = entry;
  const topShare = top && read > 0 ? top.count / read : 0;
  const hasMajority = topShare > 0.5;
  const complete = (read >= NAME_SAMPLE_MIN && hasMajority) || read >= NAME_SAMPLE_MAX;
  const target = read < NAME_SAMPLE_MIN ? NAME_SAMPLE_MIN : NAME_SAMPLE_MAX;
  return {
    read,
    topName: top?.display ?? null,
    topShare,
    hasMajority,
    complete,
    need: complete ? 0 : target - read,
  };
}

/** A failed read waits this long before onboarding tries the page again. */
export const NAME_READ_RETRY_AFTER_MS = 10 * 60 * 1000;

/**
 * Failure notes (DiscoveredUrl.lastPreflightError) that may pass on a retry:
 * a timeout, a dropped connection, a rate limit or a server error. A 404, a
 * withheld page or a page without a name will answer the same again.
 */
export const RETRYABLE_READ_FAILURES = [
  'HTTP 0',
  'HTTP 429',
  'HTTP 5',
  'fetch timeout',
  'fetch failed',
];
