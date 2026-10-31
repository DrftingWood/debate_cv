import Link from 'next/link';
import { Badge } from '@/components/ui/Badge';
import { TabLink } from '@/components/admin/TabLink';
import { BAND_BADGE } from '@/components/admin/bandBadge';
import type { LookupResult } from '@/lib/admin/tournamentLookup';
import { scrapedStamp } from '@/lib/utils/scrapedLabel';

/**
 * A lookup's answer as it crosses the wire: the API sends the scrape date as
 * an ISO string, and the page passes it the same way, so one view serves
 * the server-rendered search and the client's "Look up".
 */
export type LookupView =
  | Exclude<LookupResult, { kind: 'stored' }>
  | (Omit<Extract<LookupResult, { kind: 'stored' }>, 'scrapedAt'> & { scrapedAt: string });

export function toLookupView(r: LookupResult): LookupView {
  return r.kind === 'stored' ? { ...r, scrapedAt: r.scrapedAt.toISOString() } : r;
}

/**
 * "Is this tournament in the database?", answered in words (UX-34): stored
 * with its tab, scrape time, score and band and a link to its admin page;
 * "Not in the database" with its public tab when one is known; or "That
 * isn't a tab URL". Neither server nor client: both the page and the lookup
 * box render it.
 */
export function LookupResultView({ result, now }: { result: LookupView; now: Date }) {
  if (result.kind === 'invalid') {
    return <p className="text-ui text-ink">That isn&apos;t a tab URL</p>;
  }
  if (result.kind === 'not_stored') {
    return (
      <p className="flex flex-wrap items-baseline gap-x-tight gap-y-hair text-ui">
        <span className="font-medium text-ink">Not in the database</span>
        {result.publicUrl ? (
          <TabLink
            url={result.publicUrl}
            text="Tab"
            of={result.slug ?? result.host}
            className="text-caption"
          />
        ) : null}
      </p>
    );
  }
  const stamp = scrapedStamp(new Date(result.scrapedAt), now);
  return (
    <div className="space-y-hair">
      <p className="flex flex-wrap items-baseline gap-x-tight gap-y-hair text-ui">
        <span className="wrap-break-word font-medium text-ink">{result.name}</span>
        <TabLink url={result.publicUrl} text="Tab" of={result.name} className="text-caption" />
      </p>
      <p className="flex flex-wrap items-center gap-x-tight gap-y-hair text-caption text-ink-soft">
        {stamp.iso ? (
          <time dateTime={stamp.iso} className="font-mono tabular-nums">
            Stored {stamp.text}
          </time>
        ) : (
          <span className="font-mono tabular-nums">{stamp.text}</span>
        )}
        {result.parserCurrent ? null : <Badge variant="warning">Old parser</Badge>}
        {result.score != null && result.band ? (
          <span className="inline-flex items-baseline gap-inline">
            <Badge variant={BAND_BADGE[result.band].variant}>{BAND_BADGE[result.band].text}</Badge>
            <span className="num text-ink">{result.score}</span>
          </span>
        ) : (
          <span>Not audited yet</span>
        )}
        {result.partlyLoaded ? <Badge variant="warning">Partly loaded</Badge> : null}
      </p>
      <Link
        href={`/admin/tournaments/${result.id}`}
        className="inline-block text-ui text-ink underline underline-offset-4 hover:text-primary"
      >
        Open {result.name} →
      </Link>
    </div>
  );
}
