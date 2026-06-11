import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Download } from 'lucide-react';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { ClearDataButton, FullWipeButton, ReingestAllButton } from '@/components/AdminActions';
import { ExportErrorsButton } from '@/components/DashboardActions';
import { IngestProgressTracker } from '@/components/IngestProgressTracker';
import { categoryLabel } from '@/lib/cvErrorReports/categories';
import { Button } from '@/components/ui/Button';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  try {
    await requireAdmin();
  } catch {
    redirect('/');
  }

  const [tournaments, discoveredUrls, lockedUrls, pendingJobs, recentParserRuns, cvReports] = await Promise.all([
    prisma.tournament.count(),
    prisma.discoveredUrl.count(),
    prisma.discoveredUrl.count({ where: { reingestLocked: true } }),
    prisma.ingestJob.count({ where: { status: 'pending' } }),
    // Recent ParserRuns with non-empty warnings, capped at 200 — enough to
    // give a sense of warning frequency without scanning the whole table.
    // Most-recent-first so frequencies reflect current parser version.
    prisma.parserRun.findMany({
      where: { warnings: { isEmpty: false } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { warnings: true, parserName: true, parserVersion: true, createdAt: true },
    }),
    prisma.cvErrorReport.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { user: { select: { name: true, email: true } } },
    }),
  ]);

  const cvReportTournamentIds = [
    ...new Set(cvReports.flatMap((report) => report.tournamentIds)),
  ].filter((id) => /^\d+$/.test(id));
  const cvReportTournaments = cvReportTournamentIds.length
    ? await prisma.tournament.findMany({
        where: { id: { in: cvReportTournamentIds.map((id) => BigInt(id)) } },
        select: { id: true, name: true, year: true },
      })
    : [];
  const cvReportTournamentById = new Map(
    cvReportTournaments.map((t) => [t.id.toString(), t] as const),
  );

  // Aggregate warnings by their first sentence so semantically-equivalent
  // messages (different URLs in the suffix) collapse. The diagnostic format
  // uses ` — ` as a separator between the headline and details; we group
  // on the headline.
  const warningHeadline = (w: string): string => {
    const sep = w.indexOf(' — ');
    return (sep > 0 ? w.slice(0, sep) : w).slice(0, 200);
  };
  const warningCounts = new Map<string, { count: number; sample: string; latest: Date }>();
  for (const run of recentParserRuns) {
    for (const w of run.warnings) {
      const key = `[${run.parserName}] ${warningHeadline(w)}`;
      const existing = warningCounts.get(key);
      if (existing) {
        existing.count += 1;
        if (run.createdAt > existing.latest) existing.latest = run.createdAt;
      } else {
        warningCounts.set(key, { count: 1, sample: w, latest: run.createdAt });
      }
    }
  }
  const sortedWarnings = [...warningCounts.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20);

  return (
    <div className="mx-auto max-w-5xl space-y-8">
      <header className="space-y-3">
        <div className="eyebrow">ADMIN · INTERNAL</div>
        <h1 className="font-display text-h2 text-record-ink">
          Operator tools.
        </h1>
        <hr className="hairline" />
      </header>

      <IngestProgressTracker scope="global" />

      <section className="rounded-lg border p-6 space-y-4">
        <h2 className="font-display text-h3 text-record-ink">Current state</h2>
        <dl className="grid grid-cols-4 gap-4 text-table">
          <div>
            <dt className="text-record-muted">Tournaments</dt>
            <dd className="text-stat font-semibold mt-1">{tournaments}</dd>
          </div>
          <div>
            <dt className="text-record-muted">Discovered URLs</dt>
            <dd className="text-stat font-semibold mt-1">{discoveredUrls}</dd>
          </div>
          <div>
            <dt className="text-record-muted">Locked URLs</dt>
            <dd className="text-stat font-semibold mt-1">{lockedUrls}</dd>
          </div>
          <div>
            <dt className="text-record-muted">Pending jobs</dt>
            <dd className="text-stat font-semibold mt-1">{pendingJobs}</dd>
          </div>
        </dl>
        {/* Raw ingest-error dump (.txt). Lived on the user dashboard until
            the 2026-06 IA pass — it's operator tooling, not a debater need. */}
        <ExportErrorsButton />
      </section>

      <section className="rounded-lg border p-6 space-y-4">
        <h2 className="font-display text-h3 text-record-ink">Tag proposals</h2>
        <p className="text-body text-record-muted">
          Review user-proposed region and motion tags. Approvals write directly to the
          canonical Tournament / Motion columns.
        </p>
        <Link href="/admin/tags">
          <Button variant="outline" size="sm">Review tag proposals →</Button>
        </Link>
      </section>

      <section className="rounded-lg border p-6 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-h3 text-record-ink">CV error reports</h2>
            <p className="text-body text-record-muted mt-1">
              Beta reports users submitted from their CV page.
            </p>
          </div>
          <a href="/api/admin/cv-error-reports-export">
            <Button variant="outline" size="sm" leftIcon={<Download className="h-3.5 w-3.5" aria-hidden />}>
              Export CSV
            </Button>
          </a>
        </div>
        {cvReports.length === 0 ? (
          <p className="text-body text-record-muted">No CV reports yet.</p>
        ) : (
          <ul className="divide-y divide-record-ink/10 rounded-md border border-record-ink/15">
            {cvReports.map((report) => (
              <li key={report.id} className="space-y-2 px-3 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-ui font-medium text-record-ink">
                    {report.user.name ?? report.user.email ?? report.userId}
                  </div>
                  <div className="text-caption text-record-muted">
                    {report.createdAt.toLocaleString()}
                  </div>
                </div>
                {report.user.email ? (
                  <div className="text-caption text-record-muted">{report.user.email}</div>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  {report.tournamentIds.map((id) => {
                    const tournament = cvReportTournamentById.get(id);
                    return (
                      <span
                        key={id}
                        className="rounded-full bg-record-ink/[0.06] px-2 py-0.5 text-meta text-record-muted"
                      >
                        {tournament ? `${tournament.name}${tournament.year ? ` ${tournament.year}` : ''}` : `#${id}`}
                      </span>
                    );
                  })}
                </div>
                {report.categories.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {report.categories.map((c) => (
                      <span
                        key={c}
                        className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-meta font-medium text-warning"
                      >
                        {categoryLabel(c)}
                      </span>
                    ))}
                  </div>
                ) : null}
                {report.comment ? (
                  <p className="whitespace-pre-wrap break-words rounded-md bg-record-ink/[0.04] px-3 py-2 text-ui text-record-ink">
                    {report.comment}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="font-display text-h3 text-record-ink">Recent parser warnings</h2>
          <p className="text-body text-record-muted mt-1">
            Top warnings from the latest 200 parser runs, grouped by headline. High counts mean
            many tournaments are hitting the same parsing issue — usually a structural change in
            Tabbycat the parser hasn&rsquo;t caught up to yet.
          </p>
        </div>
        {sortedWarnings.length === 0 ? (
          <p className="text-body text-record-muted">
            No warnings recorded in the last 200 parser runs. Parsers are clean.
          </p>
        ) : (
          <ul className="divide-y divide-record-ink/10 rounded-md border border-record-ink/15">
            {sortedWarnings.map(([key, { count, sample, latest }]) => (
              <li key={key} className="px-3 py-2 space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <code className="font-mono text-caption text-record-ink break-all">{key}</code>
                  <span className="shrink-0 text-caption font-mono text-record-muted">
                    ×{count}
                  </span>
                </div>
                <div className="text-meta text-record-muted">
                  Latest: {latest.toLocaleString()} · Sample: {sample.slice(0, 200)}
                  {sample.length > 200 ? '…' : ''}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="font-display text-h3 text-record-ink">Clear ingested data</h2>
          <p className="text-body text-record-muted mt-1">
            Deletes scraped tournament records and resets ingest state on every DiscoveredUrl. User
            identity claims (Person records) and discovered URLs are preserved, so the next scan
            re-uses everyone&rsquo;s existing claims.
          </p>
        </div>
        <ClearDataButton />
      </section>

      <section className="rounded-lg border border-destructive/30 bg-destructive/[0.03] p-6 space-y-4">
        <div>
          <h2 className="font-display text-h3 text-record-ink">Full wipe (destructive)</h2>
          <p className="text-body text-record-muted mt-1">
            All of the above, <em>plus</em> deletes every DiscoveredUrl, every Person row, and
            every PersonRejection across all users. User accounts and Gmail tokens are preserved
            so users can re-run the Gmail scan from zero. Use only to test the discovery + claim
            flow end-to-end.
          </p>
          <p className="text-table text-destructive mt-2">
            Irreversible. Every user loses their claimed identities.
          </p>
        </div>
        <FullWipeButton />
      </section>

      <section className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="font-display text-h3 text-record-ink">Re-ingest all URLs</h2>
          <p className="text-body text-record-muted mt-1">
            Queues every discovered URL for fresh ingestion. Use after parser fixes to re-scrape all
            tournaments cleanly, excluding URLs locked on user dashboards. Then use{' '}
            <span className="font-medium">Ingest all</span> on the dashboard to process the queue.
          </p>
        </div>
        <ReingestAllButton />
      </section>
    </div>
  );
}
