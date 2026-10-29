'use client';

import { useEffect, useState } from 'react';
import {
  cooldownSeconds,
  cooldownSpoken,
  secondsLeft,
  type ScanNotice,
} from '@/lib/ingest/scanErrorMessage';

type CooldownNotice = ScanNotice & { kind: 'cooldown' };

export type ScanCooldown = ReturnType<typeof useScanCooldown>;

/**
 * The Scan button's cooldown clock. `start` locks it for the server's
 * `retryAfterSec`; it re-reads the wall clock every second rather than
 * counting ticks, so a backgrounded tab (where timers are throttled) shows
 * the right time the moment it is looked at again.
 */
export function useScanCooldown() {
  const [until, setUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<CooldownNotice | null>(null);
  const [ended, setEnded] = useState(false);

  useEffect(() => {
    if (until === null) return;
    const id = window.setInterval(() => {
      const t = Date.now();
      if (secondsLeft(until, t) === 0) {
        setUntil(null);
        setNotice(null);
        setEnded(true);
      } else {
        setNow(t);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [until]);

  const start = (next: CooldownNotice) => {
    const t = Date.now();
    setNow(t);
    setUntil(t + cooldownSeconds(next) * 1000);
    setNotice(next);
    setEnded(false);
  };

  const remainingSec = until === null ? 0 : secondsLeft(until, now);
  return { active: until !== null && remainingSec > 0, remainingSec, notice, ended, start };
}

/**
 * The cooldown notice under the Scan button. Neutral ink, not the
 * destructive tone: nothing failed.
 *
 * The wrapper is a polite status region that exists from the first render
 * (a region inserted together with its text is often not announced), and
 * its text changes twice per cooldown: at the start, with the wait in words
 * fixed at the value the cooldown began with, and at the end. The ticking
 * clock lives on the button label, which is not a live region, so a screen
 * reader is never read a new second.
 */
export function ScanCooldownNotice({ cooldown, id }: { cooldown: ScanCooldown; id: string }) {
  const { notice, ended } = cooldown;
  return (
    <div role="status" className="text-caption text-ink-soft sm:text-right">
      {notice ? (
        <p id={id} className="mt-hair">
          <span className="font-medium text-ink">{notice.title}.</span> {notice.description}
          <span className="sr-only"> {cooldownSpoken(cooldownSeconds(notice))}</span>
        </p>
      ) : ended ? (
        <p className="sr-only">You can scan Gmail again.</p>
      ) : null}
    </div>
  );
}
