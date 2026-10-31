import { scrapedStamp } from '@/lib/utils/scrapedLabel';

/**
 * A scrape time as the admin ledgers show it: relative, in a <time> with its
 * date. The Re-ingest-all marker is not a date, so it is plain words with no
 * <time> (lib/utils/scrapedLabel.ts).
 */
export function ScrapedTime({ date, now }: { date: Date; now: Date }) {
  const { text, iso } = scrapedStamp(date, now);
  const cls = 'block font-mono tabular-nums text-ink-soft';
  return iso ? (
    <time dateTime={iso} className={cls}>
      {text}
    </time>
  ) : (
    <span className={cls}>{text}</span>
  );
}
