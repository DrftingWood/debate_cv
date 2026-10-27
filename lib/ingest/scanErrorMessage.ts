import type { ApiFailure } from '@/lib/utils/api';
import { spokenDuration, userMessage } from '@/lib/ingest/userMessage';

/**
 * What to tell the user when a Gmail scan is refused.
 *
 * The scan route allows one scan per user every two minutes (and twelve an
 * hour), and opening the Record page starts a background scan of its own, so
 * a click on "Scan Gmail" shortly afterwards is refused with status 429 and
 * the bare code "rate_limited". That is a harmless wait, not a failure. It
 * used to arrive under a red "Scan failed" heading; it is now a neutral
 * notice, and when the server says how long to wait (`retryAfterSec`) the
 * Scan button counts it down and unlocks itself at zero.
 */
export type ScanNotice =
  | { kind: 'cooldown'; title: string; description: string; retryAfterSec?: number }
  | { kind: 'info' | 'error'; title: string; description: string };

/**
 * The server's own cooldown is two minutes. A wait reported longer than
 * this is the hourly cap (twelve scans an hour), which reads differently.
 */
const SCAN_COOLDOWN_SEC = 120;

export function scanErrorMessage(
  failure: Pick<ApiFailure, 'status' | 'error' | 'hint' | 'retryAfterSec'>,
): ScanNotice {
  if (failure.status === 429 || failure.error === 'rate_limited') {
    const wait = failure.retryAfterSec;
    const hourly = wait !== undefined && wait > SCAN_COOLDOWN_SEC;
    return {
      kind: 'cooldown',
      title: hourly ? 'Scan limit reached' : 'Scanned a moment ago',
      description: hourly
        ? 'Scans are limited to twelve an hour. Nothing is wrong; the button unlocks when the timer ends.'
        : 'Scans are limited to one every 2 minutes, and opening your Record also scans. Nothing is wrong; the button unlocks when the timer ends.',
      retryAfterSec: wait,
    };
  }
  const message = userMessage(failure);
  return {
    kind: message.kind,
    title: message.kind === 'info' ? 'Scan postponed' : 'Scan did not finish',
    description: message.description,
  };
}

/** Whole seconds left until `untilMs`, never negative. */
export function secondsLeft(untilMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((untilMs - nowMs) / 1000));
}

/** "1:42" for the button label; "1:02:03" once the wait passes an hour. */
export function formatCountdown(totalSec: number): string {
  const sec = Math.max(0, Math.ceil(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/**
 * The wait as the polite status region speaks it when a cooldown starts.
 * It is set once, not on every tick: a live region that changes each second
 * talks over everything else on the page (UX-19). The visible clock is the
 * button label ("Scan again in 1:42"), which is not a live region.
 */
export function cooldownSpoken(seconds: number): string {
  return `You can scan again in ${spokenDuration(seconds)}.`;
}

/**
 * When the server gives no wait (a proxy stripped the header), the button
 * still locks for the documented cooldown rather than inviting a click that
 * is certain to be refused.
 */
export function cooldownSeconds(notice: ScanNotice & { kind: 'cooldown' }): number {
  return notice.retryAfterSec ?? SCAN_COOLDOWN_SEC;
}
