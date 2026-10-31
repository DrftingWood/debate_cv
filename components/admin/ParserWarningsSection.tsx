import { EmptyState } from '@/components/ui/EmptyState';
import { Pager } from '@/components/ui/Pager';
import { CheckActionsProvider } from '@/components/admin/CheckActions';
import { ParserWarningsTable, type WarningRow } from '@/components/admin/ParserWarningsTable';
import { LoadFailed } from '@/components/admin/LoadFailed';
import { ViewChips } from '@/components/admin/ViewChips';
import { adminHref, type SearchValues } from '@/lib/admin/adminHref';
import { markCell } from '@/lib/admin/markCell';
import type { ParserFilter, ParserList, ParserRowData } from '@/lib/admin/parserList';
import { WARNING_RUN_CAP, WARNINGS_PER_PAGE } from '@/lib/admin/parserWarnings';
import { publicPieceUrl } from '@/lib/audit/types';
import { relativeTime } from '@/lib/utils/relativeTime';

const HASH = 'parser-warnings';

/**
 * Server side of the parser warnings ledger: each group as a row the
 * client table shows as it is, its time in words against the page's
 * clock, and every tab address made public once more before it is handed
 * to the client. A problem group carries the Mark checked cell (the same
 * `parser` fingerprint the Inbox uses); an informational one carries none.
 */
export function toWarningRows(rows: readonly ParserRowData[], now: Date): WarningRow[] {
  return rows.map((r) => ({
    key: r.key,
    parserName: r.parserName,
    headline: r.headline,
    count: r.count,
    latest: { text: relativeTime(r.latestAt, now), iso: r.latestAt.toISOString() },
    sample: r.sample,
    tournaments: r.tournaments.map((t) => ({
      ...t,
      tabUrl: t.tabUrl ? publicPieceUrl(t.tabUrl) : null,
    })),
    moreTournaments: r.moreTournaments,
    mark: r.fingerprint
      ? markCell({
          kind: 'parser',
          subject: r.key,
          fingerprint: r.fingerprint,
          checked: r.checked,
          changed: r.changed,
        })
      : null,
  }));
}

const EXPLAIN: Record<ParserFilter, string> = {
  problems:
    'Faults in reading a page, from the last 30 days and grouped by parser and headline. A high count means many tournaments hit the same issue, usually a change in Tabbycat the parser has not caught up with. Mark checked once you have looked; it comes back if the count grows into a new range.',
  info: 'These are expected states, not faults: a tournament chose not to publish a tab, or the parser found its way round a missing link. There is nothing to fix and nothing to mark.',
  checked:
    'Problems you marked checked. Undo puts one back under Problems; one that has grown into a new range comes back by itself.',
};

const EMPTY: Record<ParserFilter, { title: string; description: string }> = {
  problems: {
    title: 'No parser problems need you',
    description:
      'Every warning in the last 30 days is an expected state or marked checked. Choose Informational or Checked above to see them.',
  },
  info: {
    title: 'No informational notes in the last 30 days',
    description: 'No tournament chose to withhold a tab in that time.',
  },
  checked: {
    title: 'Nothing is marked checked',
    description: 'Press Mark checked on a problem and it waits here, with Undo.',
  },
};

/**
 * "Parser warnings" on /admin: the problems that need the owner by default
 * (`?parser=`), the informational notes apart, and the ones already checked.
 * The caption states the read's bounds, so a count is never taken for all
 * time.
 */
export function ParserWarningsSection({
  list,
  now,
  search,
}: {
  /** Null when the read failed: the section says so. */
  list: ParserList | null;
  now: Date;
  search: SearchValues;
}) {
  const filter = list?.filter ?? 'problems';
  const view = (f: ParserFilter, page = 1) =>
    adminHref(
      search,
      { parser: f === 'problems' ? null : f, warningsPage: page > 1 ? String(page) : null },
      HASH,
    );
  return (
    <section aria-labelledby={HASH} className="space-y-stack rounded-lg border p-panel">
      <div>
        <h2 id={HASH} className="font-display text-h3 font-medium text-ink">
          Parser warnings
        </h2>
        <p className="mt-hair max-w-prose text-body text-ink-soft">{EXPLAIN[filter]}</p>
        <p className="mt-hair max-w-prose text-caption text-ink-soft">
          From the latest {WARNING_RUN_CAP.toLocaleString('en-GB')} parser runs.
        </p>
      </div>
      {!list ? (
        <LoadFailed what="the parser warnings" />
      ) : (
        <Listing list={list} now={now} view={view} />
      )}
    </section>
  );
}

/** The view chips, then one page of groups or the empty state that says why. */
function Listing({
  list,
  now,
  view,
}: {
  list: ParserList;
  now: Date;
  view: (f: ParserFilter, page?: number) => string;
}) {
  const chips: Array<[ParserFilter, string]> = [
    ['problems', 'Problems'],
    ['info', 'Informational'],
    ['checked', 'Checked'],
  ];
  return (
    <>
      <ViewChips
        label="Show parser warnings by view"
        chips={chips.map(([key, label]) => ({
          key,
          label,
          count: list.counts[key],
          href: view(key),
          on: key === list.filter,
        }))}
      />
      {list.total === 0 ? (
        <EmptyState {...EMPTY[list.filter]} headingLevel={3} />
      ) : (
        <>
          <Pager
            page={list.page}
            pages={list.pages}
            total={list.total}
            perPage={WARNINGS_PER_PAGE}
            label="Parser warning pages"
            href={(n) => view(list.filter, n)}
            always
          />
          <CheckActionsProvider>
            <ParserWarningsTable rows={toWarningRows(list.rows, now)} />
          </CheckActionsProvider>
        </>
      )}
    </>
  );
}
