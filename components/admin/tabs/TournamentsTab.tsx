import { redirect } from 'next/navigation';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pager } from '@/components/ui/Pager';
import { AccuracySection } from '@/components/admin/AccuracySection';
import { LookupResultView, toLookupView } from '@/components/admin/LookupResult';
import { TournamentLookup } from '@/components/admin/TournamentLookup';
import { TournamentsTable } from '@/components/admin/TournamentsTable';
import { adminTabHref } from '@/lib/admin/adminTabs';
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
import { lookupTournament } from '@/lib/admin/tournamentLookup';
import type { SearchValues } from '@/lib/admin/adminHref';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Stored tournaments: the searchable, paged list (`?q=`, `?page=`; owner,
 * 2026-10-31: "a view if that tournament is present in the database or not",
 * then "20 per page, I click Next") above the data-accuracy section. Task R5
 * folds the accuracy section's tables into the list's filters.
 *
 * `?q=` is a name (a case-insensitive part of it: the paged list of matches)
 * or a URL (resolved by host and slug: the one answer). A page past the end
 * shows the last one. Each page is a full navigation, so Back steps through
 * them.
 */
export async function TournamentsTab({ search, now }: { search: SearchValues; now: Date }) {
  const { q, page } = readSearch(search);
  // Read here, not in async children: the panel renders in one pass.
  const isUrl = q !== '' && looksLikeUrl(q);
  const [answer, list, accuracy] = await Promise.all([
    isUrl ? lookupTournament(asLookupUrl(q) ?? q).catch(orNull('tournament lookup')) : null,
    isUrl ? null : listTournaments({ page, q: q || undefined }).catch(orNull('tournament list')),
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
        {failed ? (
          <LoadFailed what={isUrl ? 'the lookup' : 'the tournaments'} />
        ) : answer ? (
          <section aria-label="Lookup result" className="panel p-stack">
            <LookupResultView result={toLookupView(answer)} now={now} />
          </section>
        ) : list ? (
          <TournamentPage q={q} list={list} now={now} />
        ) : null}
      </section>
      <AccuracySection overview={accuracy} now={now} />
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

/** One page of the list, or the empty state that fits (UX-24 keeps the two apart). */
function TournamentPage({ q, list, now }: { q: string; list: TournamentList; now: Date }) {
  if (list.total === 0) {
    return q ? (
      <EmptyState
        // Echoed through searchBoxValue, like the box: text that is not a
        // URL can still hold a pasted private key.
        title={
          searchBoxValue(q)
            ? `Nothing matches '${searchBoxValue(q)}'`
            : 'Nothing matches that search'
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
  const href = (n: number) =>
    adminTabHref('tournaments', {
      ...(q ? { q } : {}),
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
