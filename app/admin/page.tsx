import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { ClearDataButton, FullWipeButton, ReingestAllButton } from '@/components/AdminActions';

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

  const [tournaments, discoveredUrls, pendingJobs, recentParserRuns] = await Promise.all([
    prisma.tournament.count(),
    prisma.discoveredUrl.count(),
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
  ]);

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
    <main className="mx-auto max-w-2xl px-4 py-12 space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Admin</h1>
        <p className="text-sm text-muted-foreground mt-1">Data lifecycle management</p>
      </div>

      <section className="rounded-lg border p-6 space-y-4">
        <h2 className="font-medium">Current state</h2>
        <dl className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Tournaments</dt>
            <dd className="text-xl font-semibold mt-1">{tournaments}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Discovered URLs</dt>
            <dd className="text-xl font-semibold mt-1">{discoveredUrls}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Pending jobs</dt>
            <dd className="text-xl font-semibold mt-1">{pendingJobs}</dd>
          </div>
        </dl>
      </section>

      <section className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="font-medium">Recent parser warnings</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Top warnings from the latest 200 parser runs, grouped by headline. High counts mean
            many tournaments are hitting the same parsing issue — usually a structural change in
            Tabbycat the parser hasn&rsquo;t caught up to yet.
          </p>
        </div>
        {sortedWarnings.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No warnings recorded in the last 200 parser runs. Parsers are clean.
          </p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {sortedWarnings.map(([key, { count, sample, latest }]) => (
              <li key={key} className="px-3 py-2 space-y-1">
                <div className="flex items-baseline justify-between gap-3">
                  <code className="font-mono text-[12px] text-foreground break-all">{key}</code>
                  <span className="shrink-0 text-caption font-mono text-muted-foreground">
                    ×{count}
                  </span>
                </div>
                <div className="text-[11px] text-muted-foreground">
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
          <h2 className="font-medium">Clear ingested data</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Deletes scraped tournament records and resets ingest state on every DiscoveredUrl. User
            identity claims (Person records) and discovered URLs are preserved, so the next scan
            re-uses everyone&rsquo;s existing claims.
          </p>
        </div>
        <ClearDataButton />
      </section>

      <section className="rounded-lg border border-destructive/30 bg-destructive/[0.03] p-6 space-y-4">
        <div>
          <h2 className="font-medium">Full wipe (destructive)</h2>
          <p className="text-sm text-muted-foreground mt-1">
            All of the above, <em>plus</em> deletes every DiscoveredUrl, every Person row, and
            every PersonRejection across all users. User accounts and Gmail tokens are preserved
            so users can re-run the Gmail scan from zero. Use only to test the discovery + claim
            flow end-to-end.
          </p>
          <p className="text-sm text-destructive mt-2">
            Irreversible. Every user loses their claimed identities.
          </p>
        </div>
        <FullWipeButton />
      </section>

      <section className="rounded-lg border p-6 space-y-4">
        <div>
          <h2 className="font-medium">Re-ingest all URLs</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Queues every discovered URL for fresh ingestion. Use after parser fixes to re-scrape all
            tournaments cleanly. Then use{' '}
            <span className="font-medium">Ingest all</span> on the dashboard to process the queue.
          </p>
        </div>
        <ReingestAllButton />
      </section>
    </main>
  );
}
