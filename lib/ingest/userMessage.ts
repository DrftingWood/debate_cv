import type { ApiFailure } from '@/lib/utils/api';

/**
 * Plain words for a failed API call on the Imports surfaces.
 *
 * The routes answer with machine codes (`rate_limited`, `not_a_private_url`,
 * `HTTP 500`), and those codes used to go straight into toasts and onto the
 * dashboard rows. A person cannot act on `bad_request`. Each known code maps
 * here to what happened and what to do next (UX-23; GOV.UK error-message
 * guidance). Unknown codes never reach the screen either: they fall back to
 * the route's own `hint` sentence, then to a sentence chosen by status.
 *
 * `kind` separates a real failure from a harmless wait. A rate limit, a
 * deferred import and a rescheduled deadlock all end well without the user
 * doing anything, so they are `info`, never shown under a "failed" heading
 * (UX-21).
 */
export type UserMessage = {
  kind: 'info' | 'error';
  /**
   * Set only for the harmless `info` cases, whose heading must not be the
   * caller's "… failed" title.
   */
  title?: string;
  /** One sentence: what happened and, where there is one, the next step. */
  description: string;
};

type FailureLike = Pick<ApiFailure, 'status' | 'error' | 'hint' | 'retryAfterSec'>;

const BY_CODE: Record<string, UserMessage> = {
  unauthorized: {
    kind: 'error',
    description: 'Your session has expired. Sign in again, then retry.',
  },
  no_gmail_token: {
    kind: 'error',
    description: 'Gmail is not connected. Reconnect Gmail, then scan again.',
  },
  token_invalid: {
    kind: 'error',
    description: 'Google access was revoked or has expired. Reconnect Gmail, then scan again.',
  },
  bad_request: {
    kind: 'error',
    description: 'That request could not be read. Reload the page and try again.',
  },
  not_a_private_url: {
    kind: 'error',
    description:
      'That is not a Tabbycat private URL. It should contain /privateurls/ followed by your personal key.',
  },
  not_found: {
    kind: 'error',
    description: 'That import no longer exists. Reload the page to see the current list.',
  },
  forbidden: {
    kind: 'error',
    description:
      'You can only change imports and names from tournaments you have imported yourself.',
  },
  already_claimed_by_other: {
    kind: 'error',
    description:
      'Another account claimed that name a moment ago. Search again to see the current list.',
  },
  deferred: {
    kind: 'info',
    title: 'Queued instead',
    description:
      'This tournament is large, so it has been queued. It will finish in the background shortly.',
  },
  transient_deadlock: {
    kind: 'info',
    title: 'Rescheduled',
    description:
      'Another import was writing the same tournament. This one has been rescheduled and will retry shortly.',
  },
};

/**
 * Own keys only: an unexpected 500 body such as "constructor" must not
 * resolve to `Object.prototype.constructor`.
 */
function byCode(code: string): UserMessage | undefined {
  return Object.prototype.hasOwnProperty.call(BY_CODE, code) ? BY_CODE[code] : undefined;
}

/**
 * Codes whose route sends a better, case-specific sentence than any fixed
 * one could (`identity_mismatch` names the person who did not match).
 */
const HINT_FIRST = new Set(['identity_mismatch', 'name_withdrawn']);

export function userMessage(failure: FailureLike): UserMessage {
  const { status, error, hint } = failure;

  if (status === 429 || error === 'rate_limited') {
    const wait = failure.retryAfterSec;
    return {
      kind: 'info',
      title: 'Please wait',
      description: wait
        ? `Too many requests in a short time. Try again in ${spokenDuration(wait)}.`
        : 'Too many requests in a short time. Wait a minute, then try again.',
    };
  }

  if (status === 0) {
    return {
      kind: 'error',
      description: 'Could not reach the server. Check your connection, then try again.',
    };
  }

  if (HINT_FIRST.has(error) && hint) return { kind: 'error', description: hint };
  const known = byCode(error);
  if (known) return known;
  if (hint) return { kind: 'error', description: hint };

  if (status === 504 || status === 408) {
    return {
      kind: 'error',
      description:
        'The server took too long to answer. Try again; large tournaments finish in the background.',
    };
  }
  if (status >= 500) {
    return {
      kind: 'error',
      description: `Something went wrong on our side (error ${status}). Try again in a minute.`,
    };
  }
  return {
    kind: 'error',
    description: `That did not work (error ${status}). Reload the page and try again.`,
  };
}

/**
 * A toast for a failed call: the caller's "… failed" heading for a real
 * failure, the message's own neutral heading for a harmless wait.
 */
export function failureToast(
  failure: FailureLike,
  errorTitle: string,
): { kind: 'info' | 'error'; title: string; description: string } {
  const m = userMessage(failure);
  return {
    kind: m.kind,
    title: m.kind === 'info' ? (m.title ?? 'Not finished yet') : errorTitle,
    description: m.description,
  };
}

/**
 * The same mapping for an `Error` thrown with a bare code as its message,
 * which is how `drainUntilEmpty` and the export download report failure.
 */
export function messageFromThrown(e: unknown): UserMessage {
  const raw = e instanceof Error ? e.message : '';
  const http = /^HTTP (\d{3})$/.exec(raw);
  if (http) return userMessage({ status: Number(http[1]), error: raw });
  if (raw === 'rate_limited') return userMessage({ status: 429, error: raw });
  const known = byCode(raw);
  if (known) return known;
  if (e instanceof TypeError || /failed to fetch|network|load failed/i.test(raw)) {
    return userMessage({ status: 0, error: raw });
  }
  return {
    kind: 'error',
    description: 'Something went wrong on our side. Try again in a minute.',
  };
}

/** `failureToast` for a thrown `Error`. */
export function thrownToast(
  e: unknown,
  errorTitle: string,
): { kind: 'info' | 'error'; title: string; description: string } {
  const m = messageFromThrown(e);
  return {
    kind: m.kind,
    title: m.kind === 'info' ? (m.title ?? 'Not finished yet') : errorTitle,
    description: m.description,
  };
}

/**
 * The category shown for a failed import row on the dashboard, in place of
 * the raw `IngestJob.lastError` (a scraper exception, often with a URL and a
 * stack-like suffix). The raw text stays available behind "Technical detail"
 * for the user who wants to report it.
 */
export function ingestErrorCategory(lastError: string): string {
  const text = lastError.toLowerCase();
  // Before the timeout test: these messages also say "deadline reached".
  if (/time budget|attempts without completing/.test(text))
    return 'This tournament is too large to import in the time allowed. Export errors to report it.';
  if (/http 404|not found/.test(text)) return 'This page no longer exists on the tab site.';
  if (/redirect/.test(text)) return 'The tab site sent us to an address we do not follow.';
  if (/http 401|http 403|forbidden|unauthori[sz]ed/.test(text))
    return 'The tab site refused access to this page.';
  if (/http 429|too many requests|rate.?limit/.test(text))
    return 'The tab site asked us to slow down. Retry in a few minutes.';
  if (/http 5\d\d|bad gateway|service unavailable/.test(text))
    return 'The tab site had a problem on its side. Retry later.';
  if (
    /timed? ?out|timeout|deadline|aborted|econnreset|etimedout|socket hang up|fetch failed|enotfound|eai_again/.test(
      text,
    )
  )
    return 'The tab site did not respond in time. Retry later.';
  if (/deadlock|40p01|p2034/.test(text))
    return 'Two imports collided. Retry; it usually works the second time.';
  if (/parse|unexpected|cannot read|undefined|selector/.test(text))
    return 'We could not read this tab page. Its layout may be unusual; export errors to report it.';
  return 'This import did not finish. Retry, or export errors to report it.';
}

/** "1 minute 42 seconds": the countdown as a screen reader should say it. */
export function spokenDuration(totalSec: number): string {
  const sec = Math.max(0, Math.ceil(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const parts: string[] = [];
  if (h) parts.push(unit(h, 'hour'));
  if (m) parts.push(unit(m, 'minute'));
  // Seconds are noise once the wait is measured in hours.
  if (s && !h) parts.push(unit(s, 'second'));
  return parts.length ? parts.join(' ') : '0 seconds';
}
