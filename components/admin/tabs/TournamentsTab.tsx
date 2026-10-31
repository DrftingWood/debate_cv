import { redirect } from 'next/navigation';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pager } from '@/components/ui/Pager';
import { LookupResultView, toLookupView } from '@/components/admin/LookupResult';
import { TournamentLookup } from '@/components/admin/TournamentLookup';
import { TournamentFilterChips } from '@/components/admin/TournamentFilters';
import { TournamentsTable } from '@/components/admin/TournamentsTable';
import { adminTabHref } from '@/lib/admin/adminTabs';
import type { AccuracyOverview } from '@/lib/admin/accuracy';
import { orNull } from '@/lib/admin/orNull';
import { readOverview } from '@/lib/admin/summary';
import { LoadFailed } from '@/components/admin/LoadFailed';
import {
  asLookupUrl,
  hasPrivateKeyPath,
  looksLikeUrl,
  publicFormOf,
  searchBoxValue,
} from '@/lib/admin/tabAddress';
import {
  listTournaments,
  TOURNAMENTS_PER_PAGE,
  type TournamentList,
} from '@/lib/admin/tournamentList';
import {
  filterParams,
  hasFilters,
  parseFilters,
  type TournamentFilters,
} from '@/lib/admin/tournamentFilters';
import { lookupTournament } from '@/lib/admin/tournamentLookup';
import type { SearchValues } from '@/lib/admin/adminHref';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Stored tournaments: the searchable, paged list (`?q=`, `?page=`; owner,
 * 2026-10-31: "a view if that tournament is present in the database or not",
 * then "20 per page, I click Next"), lowest score first, under the filter
 * chips that take the place of the old data-accuracy tables: a failing check
 * (`?check=`), a score band (`?band=`), the open question (`?question=`) and
 * tournaments with marks (`?checked=1`).
 *
 * `?q=` is a name (a case-insensitive part of it: the paged list of matches)
 * or a URL (resolved by host and slug: the one answer). A page past the end
 * shows the last one. Each page is a full navigation, so Back steps through
 * them.
 */
export async function TournamentsTab({ search, now }: { search: SearchValues; now: Date }) {
  const { q, page } = readSearch(search);
  const filters = parseFilters(search);
  // Read here, not in async children: the panel renders in one pass.
  const isUrl = q !== '' && looksLikeUrl(q);
  const [answer, list, accuracy] = await Promise.all([
    isUrl ? lookupTournament(asLookupUrl(q) ?? q).catch(orNull('tournament lookup')) : null,
    isUrl
      ? null
      : listTournaments({ page, q: q || undefined, filters }).catch(orNull('tournament list')),
    readOverview().catch(orNull('accuracy overview')),
  ]);
  // A failed read of the list or the lookup says so in the section, in words;
  // the accuracy section below has its own notice.
  const failed = (isUrl ? answer : list) === null;

  return (
    <div className="space-y-group">
      <section aria-labelledby="tournaments-list" className="space-y-stack">
        <h2 id="tournaments-list" className="font-display text-h3 font-medium text-ink">
          Tournaments in the database
        </h2>
        {/* The box is rendered from the request, so it shows a private URL's
            public form only (searchBoxValue): the key never reaches the HTML. */}
        <TournamentLookup defaultValue={searchBoxValue(q)} />
        {/* The chips are over the whole database, so they stay while a search or
            lookup narrows the list below them. */}
        <FilterChips overview={accuracy} filters={filters} q={q} />
        {failed ? (
          <LoadFailed what={isUrl ? 'the lookup' : 'the tournaments'} />
        ) : answer ? (
          <section aria-label="Lookup result" className="panel p-stack">
            <LookupResultView result={toLookupView(answer)} now={now} />
          </section>
        ) : list ? (
          <TournamentPage q={q} filters={filters} list={list} now={now} />
        ) : null}
      </section>
    </div>
  );
}

/**
 * The search params, read. A private URL in `q` is sent on at once to its
 * public form (same host and slug, so the same answer), before anything
 * renders: the page's flight data carries the search params, so rendering
 * with the key would put it in the response whatever the HTML shows. The box
 * itself posts (api/admin/lookup/search) to keep the key out of addresses;
 * this catches a pasted or old ?q= link.
 */
function readSearch(params: SearchValues): { q: string; page: number } {
  const q = one(params.q)?.trim() ?? '';
  if (hasPrivateKeyPath(q)) {
    const publicForm = publicFormOf(q);
    redirect(adminTabHref('tournaments', publicForm ? { q: publicForm } : {}));
  }
  const asked = Number.parseInt(one(params.page) ?? '1', 10);
  return { q, page: Number.isFinite(asked) ? asked : 1 };
}

/**
 * The chips, or the reason there are none: a failed overview read says so
 * in words (the list below still works), and a database with nothing audited
 * has nothing to filter by yet.
 */
function FilterChips({
  overview,
  filters,
  q,
}: {
  overview: AccuracyOverview | null;
  filters: TournamentFilters;
  q: string;
}) {
  if (!overview) return <LoadFailed what="the filters" />;
  if (overview.n === 0) {
    return (
      <p className="max-w-prose text-body text-ink-soft">
        No tournament is audited yet, so there is nothing to filter by. Audit now checks the next
        batch.
      </p>
    );
  }
  return <TournamentFilterChips overview={overview} filters={filters} q={q} />;
}

/** Why the list is empty: the filters, the search, or nothing stored (UX-24 keeps them apart). */
function NoRows({ q, filters }: { q: string; filters: TournamentFilters }) {
  if (filters.ignored && !hasFilters(filters)) {
    return (
      <EmptyState
        title="No ignored tournaments"
        description="Ignore a test or demo tournament from its page and it will be listed here."
        headingLevel={3}
      />
    );
  }
  if (hasFilters(filters)) {
    return (
      <EmptyState
        title="No tournament matches these filters"
        description="Choose a chip again to clear it, or search by a different name."
        headingLevel={3}
      />
    );
  }
  return q ? (
    <EmptyState
      // Echoed through searchBoxValue, like the box: text that is not a
      // URL can still hold a pasted private key.
      title={
        searchBoxValue(q) ? `Nothing matches '${searchBoxValue(q)}'` : 'Nothing matches that search'
      }
      description="Search by part of the name, or paste the tournament's tab URL."
      headingLevel={3}
    />
  ) : (
    <EmptyState
      title="No tournaments stored yet"
      description="Tournaments are stored by the pre-scrape and by users' imports."
      headingLevel={3}
    />
  );
}

/** One page of the list, or the empty state that fits (UX-24 keeps the two apart). */
function TournamentPage({
  q,
  filters,
  list,
  now,
}: {
  q: string;
  filters: TournamentFilters;
  list: TournamentList;
  now: Date;
}) {
  if (list.total === 0) return <NoRows q={q} filters={filters} />;
  const href = (n: number) =>
    adminTabHref('tournaments', {
      ...(q ? { q } : {}),
      ...filterParams(filters),
      ...(n > 1 ? { page: String(n) } : {}),
    });
  const pager = (
    <Pager
      page={list.page}
      pages={list.pages}
      total={list.total}
      perPage={TOURNAMENTS_PER_PAGE}
      label="Tournament pages"
      href={href}
    />
  );
  return (
    <div className="space-y-tight">
      {pager}
      <TournamentsTable rows={list.rows} now={now} />
      {pager}
    </div>
  );
}
