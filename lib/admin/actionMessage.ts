import type { ApiFailure } from '@/lib/utils/api';
import { userMessage } from '@/lib/ingest/userMessage';

/**
 * Plain words for a failed admin action on the overview page (UX-23). The
 * two admin routes answer with codes (`scrape_busy`, `server_error`, ...),
 * and `userMessage` already words the general ones (session expired, bad
 * request, network down, a timeout page). The codes below either mean
 * something different on an admin route (`not_found` is a tournament here,
 * not an import) or are not in that map at all, where the fallback would
 * show "error 500".
 */
type FailureLike = Pick<ApiFailure, 'status' | 'error' | 'hint' | 'retryAfterSec'>;

const SHARED: Record<string, string> = {
  forbidden: 'This account is not an admin. Sign in with an admin account, then retry.',
  server_error: 'Something went wrong on our side. Try again in a minute.',
};

const RESCRAPE: Record<string, string> = {
  ...SHARED,
  // The brief's sentence, verbatim: the lock is held by a cron retry or
  // another admin, and it clears itself when that scrape finishes.
  scrape_busy: 'Another scrape of this tournament is running. Try again in a minute.',
  not_found: 'This tournament no longer exists. Reload the page to see the current list.',
};

const RETRY: Record<string, string> = SHARED;

function lookup(map: Record<string, string>, code: string): string | undefined {
  return Object.prototype.hasOwnProperty.call(map, code) ? map[code] : undefined;
}

function generic(failure: FailureLike): string {
  // A 5xx with no code (a platform error page) would read "error 504" in
  // `userMessage`'s fallback; anything past 500 here is our side's fault.
  if (failure.status >= 500 && failure.status !== 504) return SHARED.server_error;
  return userMessage(failure).description;
}

/** Why "Retry failed" on a partly loaded tournament did not run. */
export function rescrapeFailureMessage(failure: FailureLike): string {
  return lookup(RESCRAPE, failure.error) ?? generic(failure);
}

/** Why "Retry selected" or "Retry all" on the failed imports did not run. */
export function retryFailureMessage(failure: FailureLike): string {
  return lookup(RETRY, failure.error) ?? generic(failure);
}

/**
 * Why "Audit now" did not run. POST /api/admin/audit answers only the shared
 * codes (and `bad_request` / `unauthorized`, which `userMessage` words).
 */
export function auditFailureMessage(failure: FailureLike): string {
  return lookup(SHARED, failure.error) ?? generic(failure);
}

/**
 * Why "Look up" did not answer. POST /api/admin/lookup answers the shared
 * codes and `bad_request`, which here only means the text was too long.
 */
export function lookupFailureMessage(failure: FailureLike): string {
  if (failure.error === 'bad_request') return 'That is too long to be a tab URL.';
  return lookup(SHARED, failure.error) ?? generic(failure);
}
