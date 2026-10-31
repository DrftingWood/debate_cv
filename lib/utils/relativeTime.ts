import { formatDate } from '@/lib/utils/date';

/**
 * "5 min ago" / "in 30 min": how far a moment is from `now`, in the short
 * units an operator scans a column of times by. Past a month the distance
 * stops being useful and the date itself is clearer.
 *
 * Pure, and `now` is passed in rather than read: the admin page works the
 * strings out once on the server, so the client's first render matches the
 * server's HTML instead of drifting by the seconds between the two.
 */
export function relativeTime(date: Date, now: Date): string {
  const diffSec = Math.round((date.getTime() - now.getTime()) / 1000);
  const future = diffSec > 0;
  const sec = Math.abs(diffSec);
  if (sec < 60) return future ? 'in under a minute' : 'just now';
  const say = (n: number, unit: string) => (future ? `in ${n} ${unit}` : `${n} ${unit} ago`);
  const min = Math.round(sec / 60);
  if (min < 60) return say(min, 'min');
  const h = Math.round(min / 60);
  if (h < 24) return say(h, 'h');
  const d = Math.round(h / 24);
  if (d < 30) return say(d, 'd');
  return formatDate(date);
}
