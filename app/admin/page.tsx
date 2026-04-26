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

  const [tournaments, discoveredUrls, pendingJobs] = await Promise.all([
    prisma.tournament.count(),
    prisma.discoveredUrl.count(),
    prisma.ingestJob.count({ where: { status: 'pending' } }),
  ]);

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
