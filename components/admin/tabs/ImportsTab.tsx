import { EmptyState } from '@/components/ui/EmptyState';
import { Pager } from '@/components/ui/Pager';
import { ExportErrorsButton } from '@/components/DashboardActions';
import { CheckActionsProvider } from '@/components/admin/CheckActions';
import { ImportGroupsTable, type ImportRow } from '@/components/admin/ImportGroupsTable';
import { inDatabase } from '@/components/admin/InDatabaseCell';
import { LoadFailed } from '@/components/admin/LoadFailed';
import { ViewChips } from '@/components/admin/ViewChips';
import { adminHref, type SearchValues } from '@/lib/admin/adminHref';
import { readPage } from '@/lib/admin/cvReportTypes';
import {
  IMPORTS_PER_PAGE,
  listImports,
  readImportsFilter,
  type ImportList,
  type ImportRowData,
  type ImportsFilter,
} from '@/lib/admin/importsList';
import { markCell } from '@/lib/admin/markCell';
import { orNull } from '@/lib/admin/orNull';
import { scrubComment } from '@/lib/admin/scrub';
import { publicPieceUrl } from '@/lib/audit/types';
import { relativeTime } from '@/lib/utils/relativeTime';

const HASH = 'failed-imports';

/** What each view is, in words, under the heading. */
const EXPLAIN: Record<ImportsFilter, string> = {
  failing:
    'Tournaments that are not stored and whose import still fails. Fix queues the import again; Mark checked when the failure is expected, and it comes back by itself if the failure changes.',
  covered:
    'Failed imports whose tournament is stored: the user already has this tournament from the stored copy, so there is nothing to fix.',
  checked:
    'Failures you marked checked. Undo puts one back under Failing; one whose failure has changed comes back by itself.',
  all: 'Every failed import: what needs you first, then what you checked, then what the stored copy covers.',
};

const EMPTY: Record<ImportsFilter, { title: string; description: string }> = {
  failing: {
    title: 'No failed import needs you',
    description:
      'Every failed import is covered by a stored copy or marked checked. Choose Covered by stored copy or Checked above to see them.',
  },
  covered: {
    title: 'No failed import is covered by a stored copy',
    description: 'A failed import lands here when its tournament is already stored.',
  },
  checked: {
    title: 'Nothing is marked checked',
    description: 'Press Mark checked on a failing import and it waits here, with Undo.',
  },
  all: {
    title: 'No failed imports',
    description: 'An import lands here when it fails on every attempt.',
  },
};

/**
 * Server side of the Imports ledger: each row as the client buttons need it.
 * The tab address goes through publicPieceUrl (a stored URL can be a
 * `/privateurls/<key>/` address, which signs in as the participant), times
 * are put into words against the page's clock, and Mark checked carries the
 * same `import` fingerprint the Inbox does.
 */
export function toImportRows(rows: readonly ImportRowData[], now: Date): ImportRow[] {
  return rows.map((r) => ({
    key: r.key,
    section: r.section,
    name: scrubComment(r.name),
    tournamentId: r.tournamentId,
    tabUrl: r.tabUrl ? publicPieceUrl(r.tabUrl) : null,
    tab: r.tab,
    error: scrubComment(r.error),
    attempts: r.attempts,
    users: r.users,
    moreUsers: r.moreUsers,
    latest: r.latest ? { text: relativeTime(r.latest, now), iso: r.latest.toISOString() } : null,
    jobIds: r.jobIds,
    stored:
      r.section === 'covered' && r.tournamentId
        ? inDatabase({ id: r.tournamentId, name: r.name, scrapedAt: r.scrapedAt }, now)
        : null,
    mark:
      r.section === 'failing' && r.fingerprint
        ? markCell({
            kind: 'import',
            subject: r.key,
            fingerprint: r.fingerprint,
            checked: r.checked,
            changed: r.changed,
          })
        : null,
  }));
}

/**
 * Failed imports, focused on what needs the owner (`?imports=`): the ones
 * whose tournament is not stored (default), those the stored copy covers,
 * those already checked, or all. 20 a page (`?importsPage=`). "Export
 * errors", the raw ingest-error dump, lives here with the data it dumps.
 */
export async function ImportsTab({ search, now }: { search: SearchValues; now: Date }) {
  const filter = readImportsFilter(search.imports);
  const list = await listImports({ filter, page: readPage(search.importsPage) }).catch(
    orNull('failed imports'),
  );
  return (
    <section aria-labelledby={HASH} className="space-y-stack rounded-lg border p-panel">
      <div className="flex flex-wrap items-start justify-between gap-tight">
        <div>
          <h2 id={HASH} className="font-display text-h3 font-medium text-ink">
            Failed imports
          </h2>
          <p className="mt-hair max-w-prose text-body text-ink-soft">{EXPLAIN[filter]}</p>
        </div>
        {/* Raw ingest-error dump (.txt). Lived on the user dashboard until
            the 2026-06 IA pass; it is operator tooling, not a debater need. */}
        <ExportErrorsButton />
      </div>
      {list ? <Body list={list} search={search} now={now} /> : <LoadFailed what="the imports" />}
    </section>
  );
}

function Body({ list, search, now }: { list: ImportList; search: SearchValues; now: Date }) {
  const all = list.counts.failing + list.counts.checked + list.counts.covered;
  const view = (f: ImportsFilter, page = 1) =>
    adminHref(
      search,
      { imports: f === 'failing' ? null : f, importsPage: page > 1 ? String(page) : null },
      HASH,
    );
  const chips = [
    { key: 'failing', label: 'Failing', count: list.counts.failing },
    { key: 'covered', label: 'Covered by stored copy', count: list.counts.covered },
    { key: 'checked', label: 'Checked', count: list.counts.checked },
    { key: 'all', label: 'All', count: all },
  ] as const;
  return (
    <>
      <ViewChips
        label="Show failed imports by view"
        chips={chips.map((c) => ({ ...c, href: view(c.key), on: c.key === list.filter }))}
      />
      {list.truncated ? (
        <p role="status" className="text-caption text-ink-soft">
          Older failures weren&rsquo;t scanned: only the newest failed imports are read, so some
          older ones may be missing from these counts.
        </p>
      ) : null}
      {list.total === 0 ? (
        <EmptyState {...EMPTY[list.filter]} headingLevel={3} />
      ) : (
        <>
          <Pager
            page={list.page}
            pages={list.pages}
            total={list.total}
            perPage={IMPORTS_PER_PAGE}
            label="Failed import pages"
            href={(n) => view(list.filter, n)}
            always
          />
          <CheckActionsProvider>
            <ImportGroupsTable rows={toImportRows(list.rows, now)} />
          </CheckActionsProvider>
        </>
      )}
    </>
  );
}
