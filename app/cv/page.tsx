import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SessionBadge } from '@/components/SignInOut';

export const dynamic = 'force-dynamic';

export default async function CvPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');

  const persons = await prisma.person.findMany({
    where: { claimedByUserId: session.user.id },
    include: {
      participations: {
        include: {
          tournament: true,
          roles: true,
          speakerRoundScores: { orderBy: { roundNumber: 'asc' } },
        },
        orderBy: { tournament: { year: 'desc' } },
      },
    },
  });

  const flatPersons = persons.flatMap((p) => p.participations.map((pp) => ({ person: p, participation: pp })));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink">My debate CV</h1>
        <SessionBadge />
        <p className="text-sm text-gray-600 mt-1">
          Built from tournaments you've been sent a private URL for. Ingest more URLs on the{' '}
          <a href="/dashboard" className="text-accent hover:underline">dashboard</a>.
        </p>
      </header>

      {flatPersons.length === 0 ? (
        <p className="text-sm text-gray-600">
          No tournaments linked to your profile yet. After you run the Gmail scan and the URLs are ingested,
          tournaments whose private URLs greet you by name will appear here.
        </p>
      ) : (
        <div className="space-y-4">
          {flatPersons.map(({ person, participation }) => (
            <article
              key={`${person.id}-${participation.tournament.id}`}
              className="rounded-md border border-gray-200 bg-white p-4"
            >
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-ink">
                  {participation.tournament.name}
                  {participation.tournament.year ? (
                    <span className="text-gray-500 font-normal"> · {participation.tournament.year}</span>
                  ) : null}
                </h2>
                <div className="text-sm text-gray-600">
                  {participation.roles.length > 0
                    ? participation.roles.map((r) => r.role).join(', ')
                    : null}
                </div>
              </header>
              <dl className="mt-3 grid grid-cols-2 md:grid-cols-4 gap-y-2 gap-x-4 text-sm">
                {participation.teamName ? (
                  <Field label="Team" value={participation.teamName} />
                ) : null}
                {participation.speakerScoreTotal ? (
                  <Field label="Speaker total" value={participation.speakerScoreTotal.toString()} />
                ) : null}
                {participation.wins != null ? (
                  <Field
                    label="Record"
                    value={`${participation.wins}W${
                      participation.losses != null ? `-${participation.losses}L` : ''
                    }`}
                  />
                ) : null}
                {participation.eliminationReached ? (
                  <Field label="Break" value={participation.eliminationReached} />
                ) : null}
              </dl>
              {participation.speakerRoundScores.length > 0 ? (
                <details className="mt-3">
                  <summary className="text-sm text-gray-600 cursor-pointer">Round-by-round scores</summary>
                  <table className="mt-2 text-xs border border-gray-200 rounded-md">
                    <thead className="bg-gray-50 text-left">
                      <tr>
                        <th className="px-2 py-1">Round</th>
                        <th className="px-2 py-1">Position</th>
                        <th className="px-2 py-1">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {participation.speakerRoundScores.map((s) => (
                        <tr key={s.id.toString()} className="border-t border-gray-100">
                          <td className="px-2 py-1">{s.roundNumber}</td>
                          <td className="px-2 py-1">{s.positionLabel || '—'}</td>
                          <td className="px-2 py-1">{s.score?.toString() ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              ) : null}
              <footer className="mt-3 text-xs text-gray-500">
                Source:{' '}
                <a
                  href={participation.tournament.sourceUrlRaw}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono break-all hover:underline"
                >
                  {participation.tournament.sourceHost}
                </a>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-gray-500">{label}</dt>
      <dd className="text-ink">{value}</dd>
    </div>
  );
}
