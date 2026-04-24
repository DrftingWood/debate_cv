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

  // Every tournament the user has a DiscoveredUrl for, plus the Person (if any)
  // the private-URL landing page said the URL was addressed to.
  const urls = await prisma.discoveredUrl.findMany({
    where: { userId, tournamentId: { not: null } },
    include: {
      tournament: true,
      registrationPerson: true,
    },
  });

  type Row = (typeof urls)[number];
  type Tournament = NonNullable<Row['tournament']>;
  type RegistrationPerson = NonNullable<Row['registrationPerson']>;

  const byTournament = new Map<
    bigint,
    { tournament: Tournament; registrationPersons: Map<bigint, RegistrationPerson> }
  >();
  for (const u of urls) {
    if (!u.tournament) continue;
    let entry = byTournament.get(u.tournament.id);
    if (!entry) {
      entry = { tournament: u.tournament, registrationPersons: new Map() };
      byTournament.set(u.tournament.id, entry);
    }
    if (u.registrationPerson) entry.registrationPersons.set(u.registrationPerson.id, u.registrationPerson);
  }

  const tournamentIds = Array.from(byTournament.keys());

  // Full roster: every participant (with their Person) for each relevant tournament.
  // Drives both the existing per-URL person rendering and the fallback "pick from roster".
  const participations = tournamentIds.length
    ? await prisma.tournamentParticipant.findMany({
        where: { tournamentId: { in: tournamentIds } },
        include: {
          person: true,
          roles: true,
          speakerRoundScores: { orderBy: { roundNumber: 'asc' } },
        },
      })
    : [];
  const partByTournamentAndPerson = new Map<string, (typeof participations)[number]>();
  const participantsByTournament = new Map<bigint, (typeof participations)[number][]>();
  for (const p of participations) {
    partByTournamentAndPerson.set(`${p.tournamentId}:${p.personId}`, p);
    const list = participantsByTournament.get(p.tournamentId) ?? [];
    list.push(p);
    participantsByTournament.set(p.tournamentId, list);
  }

  const sorted = Array.from(byTournament.values()).sort((a, b) => {
    const ya = a.tournament.year ?? 0;
    const yb = b.tournament.year ?? 0;
    if (yb !== ya) return yb - ya;
    return a.tournament.name.localeCompare(b.tournament.name);
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-ink-1">My debate CV</h1>
        <SessionBadge />
        <p className="text-sm text-ink-3 mt-1">
          Built from the tournaments you've been sent a private URL for. Use{' '}
          <strong>This is me</strong> on a tournament card to attach the registration to your
          profile and unlock per-round stats.
        </p>
      </header>

      {sorted.length === 0 ? (
        <p className="text-sm text-ink-3">
          No ingested tournaments yet. Run the{' '}
          <a href="/dashboard" className="text-primary-600 hover:underline">dashboard</a> scan,
          then come back here.
        </p>
      ) : (
        <div className="space-y-4">
          {sorted.map(({ tournament, registrationPersons }) => {
            const allParticipants = participantsByTournament.get(tournament.id) ?? [];
            const hasRegPeople = registrationPersons.size > 0;
            const hasClaimedMe = allParticipants.some(
              (p) => p.person.claimedByUserId === userId,
            );
            return (
              <article key={tournament.id.toString()} className="rounded-md border border-border bg-bg p-4">
                <header className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-lg font-semibold text-ink-1">
                    {tournament.name}
                    {tournament.year ? (
                      <span className="text-ink-4 font-normal"> · {tournament.year}</span>
                    ) : null}
                  </h2>
                  <span className="text-xs text-ink-4">{tournament.sourceHost ?? ''}</span>
                </header>

                {hasRegPeople ? (
                  <ul className="mt-3 space-y-3">
                    {Array.from(registrationPersons.values()).map((person) => {
                      const participation = partByTournamentAndPerson.get(
                        `${tournament.id}:${person.id}`,
                      );
                      const isMine = person.claimedByUserId === userId;
                      const claimedByOther = !!person.claimedByUserId && !isMine;
                      return (
                        <li key={person.id.toString()} className="border-t border-border pt-3">
                          <PersonHeader
                            person={person}
                            isMine={isMine}
                            claimedByOther={claimedByOther}
                          />
                          {participation ? (
                            <ParticipationDetails participation={participation} />
                          ) : (
                            <p className="text-xs text-ink-4 mt-2">
                              No participation row found yet — the speaker / participant tabs may
                              not have been ingested.
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                ) : (
                  <p className="mt-3 text-sm text-ink-3">
                    The private URL landing page didn't say "Private URL for &lt;name&gt;", so we
                    couldn't auto-link a participant. Pick yourself from the roster below.
                  </p>
                )}

                {/* Roster picker — shown whenever the auto-link didn't attach you (or didn't find anyone) */}
                {!hasClaimedMe && allParticipants.length > 0 ? (
                  <RosterPicker
                    participants={allParticipants.map((p) => ({
                      personId: p.person.id.toString(),
                      displayName: p.person.displayName,
                      isMine: p.person.claimedByUserId === userId,
                      claimedByOther: !!p.person.claimedByUserId && p.person.claimedByUserId !== userId,
                      role: p.roles.map((r) => r.role).join(', '),
                      teamName: p.teamName,
                    }))}
                    defaultOpen={!hasRegPeople}
                  />
                ) : null}

                <footer className="mt-3 text-xs text-ink-4">
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
            );
          })}
        </div>
      )}
    </div>
  );
}

function PersonHeader({
  person,
  isMine,
  claimedByOther,
}: {
  person: { id: bigint; displayName: string };
  isMine: boolean;
  claimedByOther: boolean;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <div>
        <span className="font-medium text-ink-1">{person.displayName}</span>
        {isMine ? <span className="ml-2 text-xs text-success-700">claimed as you</span> : null}
        {claimedByOther ? (
          <span className="ml-2 text-xs text-ink-4">claimed by another user</span>
        ) : null}
      </div>
      {!isMine && !claimedByOther ? (
        <ClaimPersonButton personId={person.id.toString()} />
      ) : null}
      {isMine ? <UnclaimPersonButton personId={person.id.toString()} /> : null}
    </div>
  );
}

type RosterEntry = {
  personId: string;
  displayName: string;
  isMine: boolean;
  claimedByOther: boolean;
  role: string;
  teamName: string | null;
};

function RosterPicker({
  participants,
  defaultOpen,
}: {
  participants: RosterEntry[];
  defaultOpen: boolean;
}) {
  const sorted = [...participants].sort((a, b) => a.displayName.localeCompare(b.displayName));
  return (
    <details open={defaultOpen} className="mt-3 rounded-md border border-border bg-bg-subtle">
      <summary className="cursor-pointer select-none px-3 py-2 text-sm text-ink-2">
        {defaultOpen ? 'Pick yourself from the tournament roster' : "Can't find yourself? Pick from the roster"} ·{' '}
        <span className="text-ink-4">{sorted.length} people</span>
      </summary>
      <ul className="divide-y divide-border">
        {sorted.map((p) => (
          <li key={p.personId} className="flex flex-wrap items-baseline justify-between gap-2 px-3 py-2 text-sm">
            <div>
              <span className="text-ink-1">{p.displayName}</span>
              {p.role ? <span className="ml-2 text-xs text-ink-4">{p.role}</span> : null}
              {p.teamName ? <span className="ml-2 text-xs text-ink-4">· {p.teamName}</span> : null}
              {p.isMine ? <span className="ml-2 text-xs text-success-700">you</span> : null}
              {p.claimedByOther ? (
                <span className="ml-2 text-xs text-ink-4">claimed by another user</span>
              ) : null}
            </div>
            {!p.isMine && !p.claimedByOther ? (
              <ClaimPersonButton personId={p.personId} label="This is me" />
            ) : null}
          </li>
        ))}
      </ul>
    </details>
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
    speakerRoundScores: {
      id: bigint;
      roundNumber: number;
      positionLabel: string | null;
      score: { toString(): string } | null;
    }[];
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
          <summary className="text-sm text-ink-3 cursor-pointer">Round-by-round scores</summary>
          <table className="mt-2 text-xs border border-border rounded-md">
            <thead className="bg-bg-muted text-left">
              <tr>
                <th className="px-2 py-1">Round</th>
                <th className="px-2 py-1">Position</th>
                <th className="px-2 py-1">Score</th>
              </tr>
            </thead>
            <tbody>
              {participation.speakerRoundScores.map((s) => (
                <tr key={s.id.toString()} className="border-t border-border">
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
      <dt className="text-xs text-ink-4">{label}</dt>
      <dd className="text-ink-1">{value}</dd>
    </div>
  );
}
