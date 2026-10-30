import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Pager } from '@/components/ui/Pager';
import { LookupResultView, toLookupView } from '@/components/admin/LookupResult';
import { TournamentLookup } from '@/components/admin/TournamentLookup';
import { TournamentsTable } from '@/components/admin/TournamentsTable';
import { requireAdmin } from '@/lib/admin';
import { looksLikeUrl, searchBoxValue } from '@/lib/admin/tabAddress';
import {
  listTournaments,
  TOURNAMENTS_PER_PAGE,
  type TournamentList,
} from '@/lib/admin/tournamentList';
import { lookupTournament } from '@/lib/admin/tournamentLookup';

export const metadata: Metadata = {
  title: 'Tournaments · Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

type Search = { q?: string | string[]; page?: string | string[] };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * "Tournaments in the database" (owner, 2026-10-31: "a view if that
 * tournament is present in the database or not", then "make it a page with
 * a page, 20 per page, I click Next").
 *
 * `?q=` is a name (a case-insensitive part of it: the paged list of
 * matches) or a URL (resolved by host and slug: the one answer). `?page=`
 * is 1-based; a page past the end shows the last one. Each page is a full
 * navigation, so Back steps through them.
 */
export default async function AdminTournamentsPage({
  searchParams,
}: {
  searchParams?: Promise<Search>;
} = {}) {
  // Same guard as /admin: anyone else is sent home, not shown the route.
  try {
    await requireAdmin();
  } catch {
    redirect('/');
  }

  const params = (await searchParams) ?? {};
  const q = one(params.q)?.trim() ?? '';
  const asked = Number.parseInt(one(params.page) ?? '1', 10);
  // One clock for every relative time on the page.
  const now = new Date();
  // Read here, not in async children: the page renders in one pass.
  const isUrl = q !== '' && looksLikeUrl(q);
  const [answer, list] = await Promise.all([
    isUrl ? lookupTournament(q) : null,
    isUrl ? null : listTournaments({ page: Number.isFinite(asked) ? asked : 1, q: q || undefined }),
  ]);

  return (
    <div className="space-y-group">
      <header className="space-y-tight">
        <div className="kicker">ADMIN · TOURNAMENTS</div>
        <h1 className="font-display text-h2 font-medium tracking-tight text-ink">
          Tournaments in the database
        </h1>
        <hr className="hairline" />
        <Link href="/admin" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          ← Admin
        </Link>
      </header>

      {/* The box is rendered from the request, so it shows a private URL's
          public form only (searchBoxValue): the key never reaches the HTML. */}
      <TournamentLookup defaultValue={searchBoxValue(q)} />

      {answer ? (
        <section aria-label="Lookup result" className="panel p-stack">
          <LookupResultView result={toLookupView(answer)} now={now} />
        </section>
      ) : list ? (
        <TournamentPage q={q} list={list} now={now} />
      ) : null}
    </div>
  );
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
      />
    ) : (
      <EmptyState
        title="No tournaments stored yet"
        description="Tournaments are stored by the pre-scrape and by users' imports."
      />
    );
  }
  const href = (n: number) => {
    const sp = new URLSearchParams();
    if (q) sp.set('q', q);
    if (n > 1) sp.set('page', String(n));
    const s = sp.toString();
    return s ? `/admin/tournaments?${s}` : '/admin/tournaments';
  };
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
