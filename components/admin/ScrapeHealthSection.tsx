import { BarList } from '@/components/ui/BarList';
import { EmptyState } from '@/components/ui/EmptyState';
import { PartlyLoadedTable, type PartlyLoadedRow } from '@/components/admin/PartlyLoadedTable';
import type { ScrapeHealth } from '@/lib/admin/scrapeHealth';
import type { PieceKind } from '@/lib/calicotab/scrapePieces';
import { relativeTime } from '@/lib/utils/relativeTime';

const KIND_LABEL: Record<PieceKind, string> = {
  team: 'Team tab',
  speaker: 'Speaker tab',
  participants: 'Participants',
  motions: 'Motions',
  break: 'Break',
  round: 'Round',
};
const KIND_ORDER: PieceKind[] = ['team', 'speaker', 'participants', 'motions', 'break', 'round'];

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n.toLocaleString('en-GB')} ${n === 1 ? one : many}`;

/**
 * The tournament's "Next retry" cell. A tournament has several failed
 * pieces on separate schedules; if any of them has used up its automatic
 * retries, nothing will ever load it without a person, so that outranks
 * the earliest scheduled time. A retry already due reads "due now" rather
 * than "3 min ago", which would sound like it had happened.
 */
function nextRetry(
  failed: ScrapeHealth['partlyLoadedTournaments'][number]['failed'],
  now: Date,
): PartlyLoadedRow['nextRetry'] {
  if (failed.length === 0 || failed.some((p) => p.nextRetryAt == null)) return null;
  const earliest = failed
    .map((p) => p.nextRetryAt as Date)
    .reduce((a, b) => (b.getTime() < a.getTime() ? b : a));
  return {
    text: earliest.getTime() <= now.getTime() ? 'due now' : relativeTime(earliest, now),
    iso: earliest.toISOString(),
  };
}

/**
 * "Scrape health": which pieces of which tournaments are failing to load,
 * and the button that retries them. A server component: the read model is
 * fetched with the rest of the page, and every time is put into words here
 * so the client table's first render matches the HTML.
 */
export function ScrapeHealthSection({ health, now }: { health: ScrapeHealth; now: Date }) {
  const byKind = [...health.failingByKind]
    .filter((k) => k.count > 0)
    .sort((a, b) => b.count - a.count || KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind))
    .map((k) => ({ label: KIND_LABEL[k.kind], value: k.count }));

  const rows: PartlyLoadedRow[] = health.partlyLoadedTournaments.map((t) => ({
    id: t.id.toString(),
    name: t.name,
    missing: t.failed.map((p) => p.label),
    lastTried: { text: relativeTime(t.lastAttemptAt, now), iso: t.lastAttemptAt.toISOString() },
    nextRetry: nextRetry(t.failed, now),
  }));

  return (
    <section aria-labelledby="scrape-health" className="space-y-stack rounded-lg border p-panel">
      <div>
        <h2 id="scrape-health" className="font-display text-h3 font-medium text-ink">
          Scrape health
        </h2>
        <p className="mt-hair text-body text-ink-soft">
          Pages of a tab that did not load. Each one is retried on its own schedule; after five
          failures it waits for you.
        </p>
      </div>

      {health.partlyLoaded === 0 ? (
        <EmptyState
          title="Every tracked tournament loaded in full"
          description={`Pieces are tracked from the next scrape of each tournament onwards, so ${plural(health.tracked, 'tournament is', 'tournaments are')} tracked so far.`}
          headingLevel={3}
        />
      ) : (
        <>
          <div className="space-y-tight">
            {/* The sample beside the aggregate (UX-35): the bars alone would
                not say whether four pieces are one tournament's or four. */}
            <p className="text-ui text-ink">
              {plural(health.failingPieces, 'failing piece')} across{' '}
              {plural(health.partlyLoaded, 'tournament')}
            </p>
            <BarList items={byKind} labelWidth="8rem" className="max-w-prose" />
            <p className="text-caption text-ink-soft">
              Retries due now: <span className="num text-ink">{health.retriesDue}</span>
              {' · '}
              Waiting for an admin (5 failures):{' '}
              <span className="num text-ink">{health.stuck}</span>
            </p>
          </div>

          <div className="space-y-inline">
            <h3 className="font-display text-h4 font-medium text-ink">Partly loaded tournaments</h3>
            <PartlyLoadedTable rows={rows} />
          </div>
        </>
      )}
      <WithheldLine count={health.withheld} />
    </section>
  );
}

/**
 * Withheld pages are not failures (the tournament keeps them private and
 * nothing retries them), so they sit outside the counts above: a line of
 * their own, only when there are any.
 */
function WithheldLine({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <p className="text-caption text-ink-soft">
      Withheld by the tournament: <span className="num text-ink">{count}</span>{' '}
      {count === 1 ? 'page' : 'pages'}, not retried
    </p>
  );
}
