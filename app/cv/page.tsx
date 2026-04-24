import { redirect } from 'next/navigation';
import Link from 'next/link';
import { Trophy, ExternalLink, Users, Search } from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { SessionBadge } from '@/components/SignInOut';
import { ClaimPersonButton, UnclaimPersonButton } from '@/components/ClaimPersonButton';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';

export const dynamic = 'force-dynamic';

export default async function CvPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const urls = await prisma.discoveredUrl.findMany({
    where: { userId, tournamentId: { not: null } },
    include: { tournament: true, registrationPerson: true },
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

  const claimedCount = participations.filter((p) => p.person.claimedByUserId === userId).length;

  return (
    <div className="space-y-8">
      <header className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-ink-1">My debate CV</h1>
          <SessionBadge />
          <p className="text-sm text-ink-3">
            Built from the tournaments you've been sent a private URL for.
          </p>
        </div>
        <div className="flex gap-2 text-sm">
          <Badge variant="neutral">{sorted.length} tournaments</Badge>
          <Badge variant={claimedCount > 0 ? 'success' : 'neutral'}>{claimedCount} claimed</Badge>
        </div>
      </header>

      {sorted.length === 0 ? (
        <EmptyState
          icon={<Trophy className="h-5 w-5" aria-hidden />}
          title="No tournaments ingested yet"
          description="Run the Gmail scan on your dashboard, then come back here to see your history."
          action={
            <Link href="/dashboard">
              <Button variant="primary" leftIcon={<Search className="h-4 w-4" aria-hidden />}>
                Open dashboard
              </Button>
            </Link>
          }
        />
      ) : (
        <div className="space-y-4">
          {sorted.map(({ tournament, registrationPersons }) => {
            const allParticipants = participantsByTournament.get(tournament.id) ?? [];
            const hasRegPeople = registrationPersons.size > 0;
            const hasClaimedMe = allParticipants.some((p) => p.person.claimedByUserId === userId);
            return (
              <Card key={tournament.id.toString()}>
                <CardBody className="space-y-4">
                  <header className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary-50 text-primary-700">
                        <Trophy className="h-4 w-4" aria-hidden />
                      </div>
                      <div>
                        <h2 className="text-lg font-semibold text-ink-1">
                          {tournament.name}
                          {tournament.year ? (
                            <span className="ml-2 text-ink-4 font-normal">{tournament.year}</span>
                          ) : null}
                        </h2>
                        <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-4">
                          <Users className="h-3.5 w-3.5" aria-hidden />
                          {allParticipants.length} participants
                          {tournament.sourceHost ? (
                            <>
                              <span>·</span>
                              <span>{tournament.sourceHost}</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <a
                      href={tournament.sourceUrlRaw}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-ink-4 hover:text-primary-600"
                    >
                      Source <ExternalLink className="h-3 w-3" aria-hidden />
                    </a>
                  </header>

                  {hasRegPeople ? (
                    <ul className="space-y-4">
                      {Array.from(registrationPersons.values()).map((person) => {
                        const participation = partByTournamentAndPerson.get(
                          `${tournament.id}:${person.id}`,
                        );
                        const isMine = person.claimedByUserId === userId;
                        const claimedByOther = !!person.claimedByUserId && !isMine;
                        return (
                          <li key={person.id.toString()} className="border-t border-border pt-4 first:border-t-0 first:pt-0">
                            <PersonHeader
                              person={person}
                              isMine={isMine}
                              claimedByOther={claimedByOther}
                            />
                            {participation ? (
                              <ParticipationDetails participation={participation} />
                            ) : (
                              <p className="mt-2 text-xs text-ink-4">
                                No participation row found yet — the speaker / participant tabs may
                                not have been ingested.
                              </p>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <p className="text-sm text-ink-3">
                      The private URL landing page didn't say "Private URL for &lt;name&gt;".
                      Pick yourself from the roster below.
                    </p>
                  )}

                  {!hasClaimedMe && allParticipants.length > 0 ? (
                    <RosterPicker
                      participants={allParticipants.map((p) => ({
                        personId: p.person.id.toString(),
                        displayName: p.person.displayName,
                        isMine: p.person.claimedByUserId === userId,
                        claimedByOther:
                          !!p.person.claimedByUserId && p.person.claimedByUserId !== userId,
                        role: p.roles.map((r) => r.role).join(', '),
                        teamName: p.teamName,
                      }))}
                      defaultOpen={!hasRegPeople}
                    />
                  ) : null}
                </CardBody>
              </Card>
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
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink-1">{person.displayName}</span>
        {isMine ? <Badge variant="success">You</Badge> : null}
        {claimedByOther ? <Badge variant="neutral">Claimed by another user</Badge> : null}
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
    <details open={defaultOpen} className="group rounded-md border border-border bg-bg-subtle">
      <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-4 py-2.5 text-sm text-ink-2">
        <span>
          {defaultOpen ? 'Pick yourself from the tournament roster' : "Can't find yourself? Pick from the roster"}
        </span>
        <span className="text-xs text-ink-4">
          {sorted.length} {sorted.length === 1 ? 'person' : 'people'} ·{' '}
          <span className="inline-block transition-transform group-open:rotate-180">▾</span>
        </span>
      </summary>
      <ul className="divide-y divide-border">
        {sorted.map((p) => (
          <li
            key={p.personId}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm"
          >
            <div>
              <span className="text-ink-1">{p.displayName}</span>
              {p.role ? <span className="ml-2 text-xs text-ink-4">{p.role}</span> : null}
              {p.teamName ? <span className="ml-2 text-xs text-ink-4">· {p.teamName}</span> : null}
              {p.isMine ? <Badge variant="success" className="ml-2">You</Badge> : null}
              {p.claimedByOther ? (
                <Badge variant="neutral" className="ml-2">Claimed by another user</Badge>
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
      <dl className="mt-3 grid grid-cols-2 gap-y-3 gap-x-6 text-sm sm:grid-cols-4">
        {participation.roles.length > 0 ? (
          <Field label="Roles" value={participation.roles.map((r) => r.role).join(', ')} />
        ) : null}
        {participation.teamName ? <Field label="Team" value={participation.teamName} /> : null}
        {participation.speakerScoreTotal ? (
          <Field label="Speaker total" value={participation.speakerScoreTotal.toString()} mono />
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
        <details className="mt-4">
          <summary className="cursor-pointer text-sm text-ink-3">Round-by-round scores</summary>
          <div className="mt-2 overflow-hidden rounded-md border border-border">
            <table className="w-full text-xs">
              <thead className="bg-bg-muted text-left text-ink-4">
                <tr>
                  <th className="px-3 py-2">Round</th>
                  <th className="px-3 py-2">Position</th>
                  <th className="px-3 py-2">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {participation.speakerRoundScores.map((s) => (
                  <tr key={s.id.toString()}>
                    <td className="px-3 py-1.5 text-ink-1">{s.roundNumber}</td>
                    <td className="px-3 py-1.5 text-ink-2">{s.positionLabel || '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-ink-1">{s.score?.toString() ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-xs text-ink-4">{label}</dt>
      <dd className={mono ? 'font-mono text-ink-1' : 'text-ink-1'}>{value}</dd>
    </div>
  );
}
