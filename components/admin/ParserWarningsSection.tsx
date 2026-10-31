import { EmptyState } from '@/components/ui/EmptyState';
import { Pager } from '@/components/ui/Pager';
import { ParserWarningsTable, type WarningRow } from '@/components/admin/ParserWarningsTable';
import { LoadFailed } from '@/components/admin/LoadFailed';
import { adminHref, type SearchValues } from '@/lib/admin/adminHref';
import {
  WARNING_RUN_CAP,
  WARNINGS_PER_PAGE,
  type ParserWarningList,
  type ParserWarningView,
} from '@/lib/admin/parserWarnings';
import { publicPieceUrl } from '@/lib/audit/types';
import { relativeTime } from '@/lib/utils/relativeTime';

const HASH = 'parser-warnings';

/**
 * Server side of the parser warnings ledger: each group as a row the
 * client table shows as it is, its time in words against the page's
 * clock, and every tab address made public once more before it is handed
 * to the client.
 */
export function toWarningRows(rows: readonly ParserWarningView[], now: Date): WarningRow[] {
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
  }));
}

/**
 * "Recent parser warnings" on /admin, where the old list was (Task 5d). The
 * caption states the read's bounds, so a count is never taken for all time.
 */
export function ParserWarningsSection({
  list,
  now,
  search,
}: {
  /** Null when the read failed: the section says so. */
  list: ParserWarningList | null;
  now: Date;
  search: SearchValues;
}) {
  const pageHref = (n: number) =>
    adminHref(search, { warningsPage: n > 1 ? String(n) : null }, HASH);
  return (
    <section aria-labelledby={HASH} className="space-y-stack rounded-lg border p-panel">
      <div>
        <h2 id={HASH} className="font-display text-h3 font-medium text-ink">
          Recent parser warnings
        </h2>
        <p className="mt-hair text-body text-ink-soft">
          Warnings from the last 30 days, grouped by parser and headline, from the latest{' '}
          {WARNING_RUN_CAP.toLocaleString('en-GB')} parser runs. A high count means many tournaments
          hit the same parsing issue, usually a change in Tabbycat the parser has not caught up
          with.
        </p>
      </div>
      {!list ? (
        <LoadFailed what="the parser warnings" />
      ) : list.total === 0 ? (
        <EmptyState
          title="No parser warnings in the last 30 days"
          description="Every parser run in that time finished without a warning."
          headingLevel={3}
        />
      ) : (
        <>
          <Pager
            page={list.page}
            pages={list.pages}
            total={list.total}
            perPage={WARNINGS_PER_PAGE}
            label="Parser warning pages"
            href={pageHref}
            always
          />
          <ParserWarningsTable rows={toWarningRows(list.rows, now)} />
        </>
      )}
    </section>
  );
}
