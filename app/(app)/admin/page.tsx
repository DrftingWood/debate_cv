import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { ClearDataButton, FullWipeButton, ReingestAllButton } from '@/components/AdminActions';
import { ExportErrorsButton } from '@/components/DashboardActions';
import { IngestProgressTracker } from '@/components/IngestProgressTracker';
import { buttonClasses } from '@/components/ui/Button';
import { StatRow, StatTile } from '@/components/ui/StatTile';
import { ScrapeHealthSection } from '@/components/admin/ScrapeHealthSection';
import { FailedImportsSection } from '@/components/admin/FailedImportsSection';
import { getScrapeHealth } from '@/lib/admin/scrapeHealth';
import { AccuracySection } from '@/components/admin/AccuracySection';
import { getAccuracyOverview } from '@/lib/admin/accuracy';
import { TournamentLookup } from '@/components/admin/TournamentLookup';
import { ReviewSetSection } from '@/components/admin/ReviewSetSection';
import { loadReviewSet, type Priority } from '@/lib/admin/reviewSet';
import { CvReportsSection } from '@/components/admin/CvReportsSection';
import { ParserWarningsSection } from '@/components/admin/ParserWarningsSection';
import { listCvReports } from '@/lib/admin/cvReports';
import { listParserWarnings } from '@/lib/admin/parserWarnings';
import { readPage, readReportFilter } from '@/lib/admin/cvReportTypes';
import type { SearchValues } from '@/lib/admin/adminHref';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

/**
 * The operator overview. Two of its ledgers page through the address
 * (Task 5d): `?reportsPage=` and `?reportsStatus=` (open by default) for the
 * CV reports, `?warningsPage=` for the parser warnings. Each keeps the
 * others when it moves (adminHref).
 */
export default async function AdminPage({
  searchParams,
}: {
  searchParams?: Promise<SearchValues>;
} = {}) {
  try {
    await requireAdmin();
  } catch {
    redirect('/');
  }
  const search = (await searchParams) ?? {};
  // One clock for every relative time on the page, so two cells written a
  // millisecond apart cannot disagree about "just now".
  const now = new Date();

  const [
    tournaments,
    discoveredUrls,
    lockedUrls,
    pendingJobs,
    failedJobCount,
    health,
    parserWarnings,
    cvReports,
    accuracy,
    reviewSet,
  ] = await Promise.all([
    prisma.tournament.count(),
    prisma.discoveredUrl.count(),
    prisma.discoveredUrl.count({ where: { reingestLocked: true } }),
    prisma.ingestJob.count({ where: { status: 'pending' } }),
    // Counted apart from the health read model, whose list is capped at
    // 200: the tile and "Retry all n" must state the real number.
    prisma.ingestJob.count({ where: { status: { in: ['failed', 'abandoned'] } } }),
    getScrapeHealth(),
    listParserWarnings({ page: readPage(search.warningsPage), now }),
    listCvReports({
      page: readPage(search.reportsPage),
      status: readReportFilter(search.reportsStatus),
    }),
    getAccuracyOverview(),
    // Open and done, so "Show done" needs no second request; read once here
    // for both the review set and the Failed imports rows' "Flagged" badge.
    loadReviewSet({ status: 'all' }),
  ]);
  const flaggedImports = new Map<string, Priority>(
    reviewSet
      .filter((f) => f.source === 'import' && f.status === 'open')
      .map((f) => [f.sourceId, f.priority]),
  );

  return (
    <div className="space-y-8">
      <header className="space-y-3">
        <div className="kicker">ADMIN · INTERNAL</div>
        <h1 className="font-display text-h2 font-medium tracking-tight text-ink">
          Admin: operator tools
        </h1>
        <hr className="hairline" />
      </header>

      <IngestProgressTracker scope="global" />

      <section className="rounded-lg border p-6 space-y-4">
        <h2 className="font-display text-h3 font-medium text-ink">Current state</h2>
        {/* Six tiles in two rows of three: a single row of six crowds the
            figures at desktop width, and StatRow's own five-column cap
            would leave one tile alone on a second line. */}
        <StatRow columns={3}>
          <StatTile label="Tournaments" value={tournaments.toLocaleString('en-GB')} />
          <StatTile label="Discovered URLs" value={discoveredUrls.toLocaleString('en-GB')} />
          <StatTile label="Locked URLs" value={lockedUrls.toLocaleString('en-GB')} />
          <StatTile label="Pending jobs" value={pendingJobs.toLocaleString('en-GB')} />
          <StatTile
            label="Partly loaded"
            value={health.partlyLoaded.toLocaleString('en-GB')}
            hint={`of ${health.tracked.toLocaleString('en-GB')} tracked`}
          />
          <StatTile label="Failed jobs" value={failedJobCount.toLocaleString('en-GB')} />
        </StatRow>
        <div className="flex flex-wrap items-center gap-inline">
          <Link
            href="/admin/tournaments"
            className={buttonClasses({ variant: 'outline', size: 'sm' })}
          >
            All tournaments →
          </Link>
          {/* Raw ingest-error dump (.txt). Lived on the user dashboard until
              the 2026-06 IA pass — it's operator tooling, not a debater need. */}
          <ExportErrorsButton />
        </div>
      </section>

      {/* The same search box as /admin/tournaments (owner, 2026-10-31: "a
          view if that tournament is present in the database or not"). */}
      <section aria-labelledby="in-database" className="space-y-stack rounded-lg border p-panel">
        <div>
          <h2 id="in-database" className="font-display text-h3 font-medium text-ink">
            Is it in the database?
          </h2>
          <p className="mt-hair text-body text-ink-soft">
            Paste a tab or private URL to see whether its tournament is stored, or type part of a
            name to list the matches.
          </p>
        </div>
        <TournamentLookup />
      </section>

      <ScrapeHealthSection health={health} now={now} />

      <FailedImportsSection
        jobs={health.failedJobs}
        total={failedJobCount}
        now={now}
        flagged={flaggedImports}
      />

      <ReviewSetSection flags={reviewSet} now={now} />

      <AccuracySection overview={accuracy} now={now} />

      {/* Tags and Verify used to sit in the CV sub-bar (admins only). That
          bar went with the 2026-10-29 navigation change, so the operator
          tools are reached from here. */}
      <section className="rounded-lg border p-6 space-y-4">
        <h2 className="font-display text-h3 font-medium text-ink">Operator tools</h2>
        <p className="text-body text-ink-soft">
          Check what the parser read, and tag tournaments and motions.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/cv/verify" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            Verify parsed tournaments →
          </Link>
          <Link href="/cv/tags" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            Tag tournaments and motions →
          </Link>
        </div>
      </section>

      <section className="rounded-lg border p-6 space-y-4">
        <h2 className="font-display text-h3 font-medium text-ink">Tag proposals</h2>
        <p className="text-body text-ink-soft">
          Review user-proposed region and motion tags. Approvals write directly to the canonical
          Tournament / Motion columns.
        </p>
        <Link href="/admin/tags" className={buttonClasses({ variant: 'outline', size: 'sm' })}>
          Review tag proposals →
        </Link>
      </section>

      <CvReportsSection list={cvReports} now={now} search={search} />

      <ParserWarningsSection list={parserWarnings} now={now} search={search} />

      <section className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="font-display text-h3 font-medium text-ink">Clear ingested data</h2>
          <p className="text-body text-ink-soft mt-1">
            Deletes scraped tournament records and resets ingest state on every DiscoveredUrl. User
            identity claims (Person records) and discovered URLs are preserved, so the next scan
            re-uses everyone&rsquo;s existing claims.
          </p>
        </div>
        <ClearDataButton />
      </section>

      <section className="rounded-lg border border-destructive/30 bg-destructive/3 p-6 space-y-4">
        <div>
          <h2 className="font-display text-h3 font-medium text-ink">Full wipe (destructive)</h2>
          <p className="text-body text-ink-soft mt-1">
            All of the above, <em>plus</em> deletes every DiscoveredUrl, every Person row, and every
            PersonRejection across all users. User accounts and Gmail tokens are preserved so users
            can re-run the Gmail scan from zero. Use only to test the discovery + claim flow
            end-to-end.
          </p>
          <p className="text-table text-destructive mt-2">
            Irreversible. Every user loses their claimed identities.
          </p>
        </div>
        <FullWipeButton />
      </section>

      <section className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="font-display text-h3 font-medium text-ink">Re-ingest all URLs</h2>
          <p className="text-body text-ink-soft mt-1">
            Queues every discovered URL for fresh ingestion. Use after parser fixes to re-scrape all
            tournaments cleanly, excluding URLs locked on user dashboards. Then use{' '}
            <span className="font-medium">Ingest all</span> on the dashboard to process the queue.
          </p>
        </div>
        <ReingestAllButton count={Math.max(0, discoveredUrls - lockedUrls)} />
      </section>
    </div>
  );
}
