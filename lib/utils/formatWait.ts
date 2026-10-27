// Pure (no imports): safe for client components. lib/rateLimit.ts re-exports it.

const unit = (n: number, name: string) => `${n} ${name}${n === 1 ? '' : 's'}`;

/**
 * A wait in seconds as a person would say it: "45 seconds", "50 minutes",
 * "1 hour 5 minutes", "1 day". The message used to be minutes only, so the
 * daily CSV limit told people to come back in "1440 minute(s)". Rounded UP at
 * the smallest unit shown, so the wait is never understated; at most two
 * units, so it stays readable. Only the message uses this — Retry-After and
 * RateLimit-Reset stay plain seconds, which is what clients parse.
 */
export function formatWait(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  if (s < 60) return unit(s, 'second');
  const m = Math.ceil(s / 60);
  if (m < 60) return unit(m, 'minute');
  if (m < 24 * 60) {
    const h = Math.floor(m / 60);
    const rem = m % 60;
    return rem ? `${unit(h, 'hour')} ${unit(rem, 'minute')}` : unit(h, 'hour');
  }
  let d = Math.floor(m / (24 * 60));
  let h = Math.ceil((m % (24 * 60)) / 60);
  if (h === 24) {
    d += 1;
    h = 0;
  }
  return h ? `${unit(d, 'day')} ${unit(h, 'hour')}` : unit(d, 'day');
}
