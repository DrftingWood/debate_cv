import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SessionBadge } from '@/components/SignInOut';
import { ClaimPersonButton, UnclaimPersonButton } from '@/components/ClaimPersonButton';

export const dynamic = 'force-dynamic';

export default async function CvPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  // Pull every tournament the user has discovered a URL for (ingested or not).
  const urls = await prisma.discoveredUrl.findMany({
    where: { userId, tournamentId: { not: null } },
    include: {
      tournament: true,
      registrationPerson: {
        include: {
          participations: {
            where: {
              tournament: {
                id: { in: [] }, // placeholder; refined below
              },
            },
            include: {
              roles: true,
              speakerRoundScores: { orderBy: { roundNumber: 'asc' } },
            },
          },
        },
      },
    },
  });

  // Group by tournament
  type Row = (typeof urls)[number];
  const byTournament = new Map<bigint, { tournament: NonNullable<Row['tournament']>; persons: Map<bigint, NonNullable<Row['registrationPerson']>> }>();
  for (const u of urls) {
    if (!u.tournament) continue;
    let entry = byTournament.get(u.tournament.id);
    if (!entry) {
      entry = { tournament: u.tournament, persons: new Map() };
      byTournament.set(u.tournament.id, entry);
    }
    if (u.registrationPerson) entry.persons.set(u.registrationPerson.id, u.registrationPerson);
  }

  // For each tournament, fetch participations of any person we want to display
  const tournamentIds = Array.from(byTournament.keys());
  const participations = tournamentIds.length
    ? await prisma.tournamentParticipant.findMany({
        where: { tournamentId: { in: tournamentIds } },
        include: { person: true, roles: true, speakerRoundScores: { orderBy: { roundNumber: 'asc' } } },
      })
    : [];
  const partByTournamentAndPerson = new Map<string, (typeof participations)[number]>();
  for (const p of participations) {
    partByTournamentAndPerson.set(`${p.tournamentId}:${p.personId}`, p);
  }

  // Sort tournaments by year desc then name
  const sorted = Array.from(byTournament.values()).sort((a, b) => {
    const ya = a.tournament.year ?? 0;
    const yb = b.tournament.year ?? 0;
    if (yb !== ya) return yb - ya;
    return a.tournament.name.localeCompare(b.tournament.name);
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink">My debate CV</h1>
        <SessionBadge />
        <p className="text-sm text-gray-600 mt-1">
          Built from the tournaments you've been sent a private URL for. Use{' '}
          <strong>This is me</strong> on a tournament card to attach the
          registration to your profile and unlock per-round stats.
        </p>
      </header>

      {sorted.length === 0 ? (
        <p className="text-sm text-gray-600">
          No ingested tournaments yet. Run the{' '}
          <a href="/dashboard" className="text-accent hover:underline">dashboard</a> scan,
          then come back here.
        </p>
      ) : (
        <div className="space-y-4">
          {sorted.map(({ tournament, persons }) => (
            <article key={tournament.id.toString()} className="rounded-md border border-gray-200 bg-white p-4">
              <header className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-lg font-semibold text-ink">
                  {tournament.name}
                  {tournament.year ? <span className="text-gray-500 font-normal"> · {tournament.year}</span> : null}
                </h2>
                <span className="text-xs text-gray-500">
                  {tournament.sourceHost ?? ''}
                </span>
              </header>

              {persons.size === 0 ? (
                <p className="mt-3 text-sm text-gray-600">
                  Tournament ingested, but the private URL didn't say "Private URL for &lt;name&gt;",
                  so we couldn't auto-link a participant. Open the source page and confirm; otherwise
                  the public tab data is still in our DB.
                </p>
              ) : (
                <ul className="mt-3 space-y-3">
                  {Array.from(persons.values()).map((person) => {
                    const participation = partByTournamentAndPerson.get(`${tournament.id}:${person.id}`);
                    const isMine = person.claimedByUserId === userId;
                    const claimedByOther = !!person.claimedByUserId && !isMine;
                    return (
                      <li key={person.id.toString()} className="border-t border-gray-100 pt-3">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <div>
                            <span className="font-medium text-ink">{person.displayName}</span>
                            {isMine ? <span className="ml-2 text-xs text-green-700">claimed as you</span> : null}
                            {claimedByOther ? <span className="ml-2 text-xs text-gray-500">claimed by another user</span> : null}
                          </div>
                          {!isMine && !claimedByOther ? (
                            <ClaimPersonButton personId={person.id.toString()} />
                          ) : null}
                          {isMine ? <UnclaimPersonButton personId={person.id.toString()} /> : null}
                        </div>
                        {participation ? (
                          <ParticipationDetails participation={participation} />
                        ) : (
                          <p className="text-xs text-gray-500 mt-2">
                            No participation row found yet — the speaker / participant tabs may not have been ingested.
                          </p>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}

              <footer className="mt-3 text-xs text-gray-500">
                <a
                  href={tournament.sourceUrlRaw}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono break-all hover:underline"
                >
                  {tournament.sourceUrlRaw}
                </a>
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}

function ParticipationDetails({
  participation,
}: {
  participation: {
    teamName: string | null;
    speakerScoreTotal: { toString(): string } | null;
    wins: number | null;
    losses: number | null;
    eliminationReached: string | null;
    roles: { role: string }[];
    speakerRoundScores: { id: bigint; roundNumber: number; positionLabel: string | null; score: { toString(): string } | null }[];
  };
}) {
  return (
    <>
      <dl className="mt-2 grid grid-cols-2 md:grid-cols-4 gap-y-2 gap-x-4 text-sm">
        {participation.roles.length > 0 ? (
          <Field label="Roles" value={participation.roles.map((r) => r.role).join(', ')} />
        ) : null}
        {participation.teamName ? <Field label="Team" value={participation.teamName} /> : null}
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
    </>
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
