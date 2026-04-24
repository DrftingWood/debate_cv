import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SessionBadge, SignOutButton } from '@/components/SignInOut';
import { ScanButton, IngestAllButton, IngestButton } from '@/components/DashboardActions';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const [urls, jobs] = await Promise.all([
    prisma.discoveredUrl.findMany({
      where: { userId: session.user.id },
      orderBy: { messageDate: 'desc' },
      take: 100,
      include: { tournament: true },
    }),
    prisma.ingestJob.findMany({
      where: { userId: session.user.id },
      orderBy: { scheduledAt: 'desc' },
      take: 100,
    }),
  ]);

  const jobByUrl = new Map(jobs.map((j) => [j.url, j] as const));
  const pending = jobs.filter((j) => j.status === 'pending').length;
  const running = jobs.filter((j) => j.status === 'running').length;
  const done = jobs.filter((j) => j.status === 'done').length;
  const failed = jobs.filter((j) => j.status === 'failed').length;

  return (
    <div className="space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-ink">Dashboard</h1>
          <SessionBadge />
        </div>
        <div className="flex items-center gap-3">
          {pending > 0 ? <IngestAllButton /> : null}
          <ScanButton />
          <SignOutButton />
        </div>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Stat label="Private URLs" value={urls.length} />
        <Stat label="Pending" value={pending} />
        <Stat label="Running" value={running} />
        <Stat label="Done" value={done} subvalue={failed ? `${failed} failed` : undefined} />
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Extracted private URLs</h2>
        {urls.length === 0 ? (
          <p className="text-sm text-gray-600">
            No URLs yet. Click "Scan Gmail" to search your inbox for Tabbycat private URLs.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm border border-gray-200 rounded-md bg-white">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-3 py-2">URL</th>
                  <th className="px-3 py-2">Tournament</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Received</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {urls.map((u) => {
                  const job = jobByUrl.get(u.url);
                  return (
                    <tr key={u.id} className="border-t border-gray-100">
                      <td className="px-3 py-2 font-mono text-xs break-all">
                        <a href={u.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                          {u.url}
                        </a>
                      </td>
                      <td className="px-3 py-2">
                        {u.tournament?.name ?? <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge
                          status={u.ingestedAt ? 'done' : (job?.status ?? 'pending')}
                        />
                        {job?.lastError && !u.ingestedAt ? (
                          <div className="text-xs text-red-600 mt-1 max-w-xs truncate" title={job.lastError}>
                            {job.lastError}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {u.messageDate ? new Date(u.messageDate).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-3 py-2">
                        <IngestButton url={u.url} alreadyDone={!!u.ingestedAt} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value, subvalue }: { label: string; value: number; subvalue?: string }) {
  return (
    <div className="rounded-md border border-gray-200 bg-white px-4 py-3">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-2xl font-semibold text-ink">{value}</div>
      {subvalue ? <div className="text-xs text-gray-500 mt-1">{subvalue}</div> : null}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: 'bg-gray-100 text-gray-700',
    running: 'bg-blue-100 text-blue-700',
    done: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs ${colors[status] ?? 'bg-gray-100 text-gray-700'}`}>
      {status}
    </span>
  );
}
