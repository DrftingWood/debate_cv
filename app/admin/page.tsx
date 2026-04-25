import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { ClearDataButton, ReingestAllButton } from '@/components/AdminActions';

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
          <h2 className="font-medium">Clear all ingested data</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Deletes all scraped tournament records and resets ingest state. User identity claims
            (Person records) are preserved.
          </p>
        </div>
        <ClearDataButton />
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
