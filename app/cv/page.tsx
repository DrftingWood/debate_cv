import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  Trophy,
  ExternalLink,
  Users,
  Search,
  Mail,
  MapPin,
  Award,
} from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { Card, CardBody } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { RankBadge } from '@/components/ui/RankBadge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { ClaimPersonButton, UnclaimPersonButton } from '@/components/ClaimPersonButton';

export const metadata: Metadata = {
  title: 'My CV',
  description: 'Your debate tournament history, compiled from your Gmail.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

function initials(name: string | null | undefined): string {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export default async function CvPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  const [user, urls] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, image: true },
    }),
    prisma.discoveredUrl.findMany({
      where: { userId, tournamentId: { not: null } },
      include: { tournament: true, registrationPerson: true },
    }),
  ]);

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
    if (u.registrationPerson)
      entry.registrationPersons.set(u.registrationPerson.id, u.registrationPerson);
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

  // Stats for header summary.
  const myParticipations = participations.filter(
    (p) => p.person.claimedByUserId === userId,
  );
  // Distinct tournaments where the user has been identified. Dedupes the
  // case where both the registration-page Person (empty placeholder) and the
  // tab-side Person (full data) are claimed for the same tournament.
  const myTournamentIds = new Set(myParticipations.map((p) => p.tournamentId));
  const breaks = myParticipations.filter((p) => p.eliminationReached).length;
  const scores = myParticipations
    .map((p) => (p.speakerScoreTotal ? Number(p.speakerScoreTotal) : null))
    .filter((s): s is number => Number.isFinite(s));
  const avgScore = scores.length
    ? (scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1)
    : null;

  // Judge summary stats for the header tile.
  const totalRoundsChaired = myParticipations.reduce(
    (sum, p) => sum + (p.chairedPrelimRounds ?? 0),
    0,
  );
  const hasJudgeHistory = myParticipations.some(
    (p) => p.judgeTypeTag || (p.chairedPrelimRounds ?? 0) > 0,
  );
  const hasSpeakerHistory = myParticipations.some(
    (p) => p.speakerScoreTotal || p.teamName,
  );

  // Build the results table rows: one row per tournament where the user has
  // been identified. When both the registration placeholder and the tab-side
  // participation are claimed for the same tournament, prefer whichever has
  // actual data (scores or judging stats) so the row isn't blank.
  type ResultRow = {
    tournamentId: bigint;
    tournamentName: string;
    year: number | null;
    format: string | null;
    sourceUrl: string;
    teamName: string | null;
    wins: number | null;
    losses: number | null;
    speakerScoreTotal: string | null;
    speakerRankOpen: number | null;
    eliminationReached: string | null;
    teamBreakRank: number | null;
    judgeTypeTag: string | null;
    chairedPrelimRounds: number | null;
    lastOutroundChaired: string | null;
    roles: string[];
  };
  const richness = (
    p: (typeof myParticipations)[number],
  ): number =>
    (p.speakerScoreTotal ? 4 : 0) +
    (p.eliminationReached ? 2 : 0) +
    ((p.chairedPrelimRounds ?? 0) > 0 ? 1 : 0) +
    p.roles.length;
  const bestPerTournament = new Map<bigint, (typeof myParticipations)[number]>();
  for (const p of myParticipations) {
    const existing = bestPerTournament.get(p.tournamentId);
    if (!existing || richness(p) > richness(existing)) {
      bestPerTournament.set(p.tournamentId, p);
    }
  }
  const resultRows: ResultRow[] = [];
  for (const [tid, p] of bestPerTournament.entries()) {
    const t = byTournament.get(tid)?.tournament;
    if (!t) continue;
    resultRows.push({
      tournamentId: tid,
      tournamentName: t.name,
      year: t.year,
      format: t.format,
      sourceUrl: t.sourceUrlRaw,
      teamName: p.teamName,
      wins: p.wins,
      losses: p.losses,
      speakerScoreTotal: p.speakerScoreTotal ? p.speakerScoreTotal.toString() : null,
      speakerRankOpen: p.speakerRankOpen,
      eliminationReached: p.eliminationReached,
      teamBreakRank: p.teamBreakRank,
      judgeTypeTag: p.judgeTypeTag,
      chairedPrelimRounds: p.chairedPrelimRounds,
      lastOutroundChaired: p.lastOutroundChaired,
      roles: p.roles.map((r) => r.role),
    });
  }
  resultRows.sort((a, b) => {
    const ya = a.year ?? -Infinity;
    const yb = b.year ?? -Infinity;
    if (ya !== yb) return yb - ya;
    return a.tournamentName.localeCompare(b.tournamentName);
  });

  // Group tournaments by year (descending).
  const grouped = new Map<number | 'unknown', typeof byTournament extends Map<unknown, infer V> ? V[] : never>();
  for (const entry of byTournament.values()) {
    const year = entry.tournament.year ?? 'unknown';
    const bucket = grouped.get(year) ?? [];
    bucket.push(entry);
    grouped.set(year, bucket);
  }
  const groupedYears = Array.from(grouped.keys()).sort((a, b) => {
    if (a === 'unknown') return 1;
    if (b === 'unknown') return -1;
    return (b as number) - (a as number);
  });

  return (
    <div className="space-y-10">
      {/* Profile header */}
      <header className="relative overflow-hidden rounded-card border border-border shadow-sm">
        <div aria-hidden className="absolute inset-0 bg-gradient-hero" />
        <div aria-hidden className="absolute inset-0 hero-texture opacity-60" />
        <div className="relative flex flex-col gap-6 p-6 md:flex-row md:items-center md:justify-between md:p-8">
          <div className="flex items-center gap-5">
            <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-gradient-accent font-display text-[20px] font-semibold text-white shadow-md">
              {initials(user?.name ?? user?.email)}
            </div>
            <div>
              <h1 className="font-display text-h2 font-semibold tracking-tight text-foreground">
                {user?.name ?? 'Debater'}
              </h1>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-muted-foreground">
                {user?.email ? (
                  <span className="inline-flex items-center gap-1.5">
                    <Mail className="h-3.5 w-3.5" aria-hidden />
                    {user.email}
                  </span>
                ) : null}
                <span className="inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" aria-hidden />
                  Auto-built from Gmail
                </span>
              </div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3 md:min-w-[380px]">
            <MetricTile label="Tournaments" value={byTournament.size} />
            {hasJudgeHistory && !hasSpeakerHistory ? (
              <>
                <MetricTile label="Prelims chaired" value={totalRoundsChaired} accent />
                <MetricTile label="Breaks" value={breaks} />
              </>
            ) : hasJudgeHistory ? (
              <>
                <MetricTile label="Breaks" value={breaks} accent />
                <MetricTile label="Prelims chaired" value={totalRoundsChaired} mono />
              </>
            ) : (
              <>
                <MetricTile label="Breaks" value={breaks} accent />
                <MetricTile label="Avg speaker" value={avgScore ?? '—'} mono />
              </>
            )}
          </div>
        </div>
      </header>

      {/* Results table — every tournament you've been identified in, with all
          the columns we have. Replaces the previous curated Highlights panel. */}
      {byTournament.size > 0 ? (
        resultRows.length > 0 ? (
          <ResultsTable rows={resultRows} />
        ) : (
          <section className="rounded-card border border-border bg-primary-50/60 p-5 md:p-6">
            <h2 className="inline-flex items-center gap-2 font-display text-h4 font-semibold text-primary-900">
              <Trophy className="h-4 w-4" aria-hidden />
              Results
            </h2>
            <p className="mt-1.5 text-[14px] text-primary-900/80">
              Your tournaments are ingested but we haven't matched you to a tab participant yet. Pick
              yourself from a tournament roster below and your results will appear here.
            </p>
          </section>
        )
      ) : null}

      {/* Summary row */}
      <div className="flex flex-wrap items-center gap-2 text-caption">
        <Badge variant="outline">{byTournament.size} tournaments</Badge>
        <Badge variant={myTournamentIds.size > 0 ? 'success' : 'neutral'}>
          {myTournamentIds.size} claimed
        </Badge>
        <Badge variant="info">{participations.length} total participations</Badge>
        <Link href="/cv/verify">
          <Button variant="outline" size="sm">Verify extracted fields</Button>
        </Link>
      </div>

      {/* Timeline */}
      {byTournament.size === 0 ? (
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
        <div className="space-y-10">
          {groupedYears.map((year) => {
            const entries = grouped.get(year)!;
            entries.sort((a, b) => a.tournament.name.localeCompare(b.tournament.name));
            return (
              <section key={String(year)} className="space-y-4">
                <header className="flex items-baseline gap-3">
                  <h2 className="font-display text-h3 font-semibold text-foreground">
                    {year === 'unknown' ? 'Year unknown' : year}
                  </h2>
                  <span className="text-caption text-muted-foreground">
                    {entries.length} {entries.length === 1 ? 'tournament' : 'tournaments'}
                  </span>
                </header>
                <div className="space-y-4">
                  {entries.map(({ tournament, registrationPersons }) => {
                    const allParticipants = participantsByTournament.get(tournament.id) ?? [];
                    const hasRegPeople = registrationPersons.size > 0;
                    // hasClaimedMe is "have I claimed the tab-side participant
                    // who has my actual scores in this tournament". A claim on
                    // the registration-page Person alone doesn't count, because
                    // that row is just an identity placeholder with no scores —
                    // we still want the RosterPicker to surface so the user
                    // can pick themselves from the tab roster when the tab
                    // spelled their name differently from the landing page.
                    const hasClaimedMe = allParticipants.some(
                      (p) => p.person.claimedByUserId === userId,
                    );
                    return (
                      <TournamentCard
                        key={tournament.id.toString()}
                        tournament={tournament}
                        registrationPersons={Array.from(registrationPersons.values())}
                        allParticipants={allParticipants}
                        userId={userId}
                        hasRegPeople={hasRegPeople}
                        hasClaimedMe={hasClaimedMe}
                        partByTournamentAndPerson={partByTournamentAndPerson}
                      />
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetricTile({
  label,
  value,
  accent,
  mono,
}: {
  label: string;
  value: number | string;
  accent?: boolean;
  mono?: boolean;
}) {
  return (
    <div
      className={
        'rounded-card border border-border bg-card/80 px-3 py-2.5 shadow-xs backdrop-blur-sm' +
        (accent ? ' bg-primary-soft/70' : '')
      }
    >
      <div className="text-caption text-muted-foreground">{label}</div>
      <div
        className={
          'mt-0.5 font-display text-[20px] font-semibold leading-tight text-foreground' +
          (mono ? ' font-mono' : '')
        }
      >
        {value}
      </div>
    </div>
  );
}

function TournamentCard({
  tournament,
  registrationPersons,
  allParticipants,
  userId,
  hasRegPeople,
  hasClaimedMe,
  partByTournamentAndPerson,
}: {
  tournament: {
    id: bigint;
    name: string;
    year: number | null;
    format: string | null;
    sourceHost: string | null;
    sourceUrlRaw: string;
  };
  registrationPersons: {
    id: bigint;
    displayName: string;
    claimedByUserId: string | null;
  }[];
  allParticipants: {
    person: { id: bigint; displayName: string; claimedByUserId: string | null };
    teamName: string | null;
    speakerScoreTotal: { toString(): string } | null;
    wins: number | null;
    losses: number | null;
    eliminationReached: string | null;
    judgeTypeTag: string | null;
    chairedPrelimRounds: number | null;
    lastOutroundChaired: string | null;
    lastOutroundPaneled: string | null;
    roles: { role: string }[];
    speakerRoundScores: {
      id: bigint;
      roundNumber: number;
      positionLabel: string | null;
      score: { toString(): string } | null;
    }[];
  }[];
  userId: string;
  hasRegPeople: boolean;
  hasClaimedMe: boolean;
  partByTournamentAndPerson: Map<string, (typeof allParticipants)[number]>;
}) {
  return (
    <Card className="transition-all duration-[180ms] ease-soft hover:shadow-md">
      <CardBody className="space-y-5">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary-soft text-primary">
              <Trophy className="h-4 w-4" aria-hidden />
            </div>
            <div>
              <h3 className="font-display text-[17px] font-semibold text-foreground">
                {tournament.name}
              </h3>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" aria-hidden />
                  {allParticipants.length} participants
                </span>
                {tournament.format ? (
                  <>
                    <span aria-hidden className="text-muted-foreground/50">·</span>
                    <Badge variant="outline">{tournament.format}</Badge>
                  </>
                ) : null}
                {tournament.sourceHost ? (
                  <>
                    <span aria-hidden className="text-muted-foreground/50">·</span>
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
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1 text-caption text-muted-foreground shadow-xs transition-colors hover:text-primary"
          >
            Source <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </header>

        {hasRegPeople ? (
          <ul className="space-y-5">
            {registrationPersons.map((person) => {
              // Primary lookup: exact match on registration-person ID.
              // Fallback: any participation in this tournament claimed by the
              // current user — covers the common case where the tab stored a
              // slightly different name spelling than the landing page, so the
              // two records have different Person IDs but the same user.
              const participation =
                partByTournamentAndPerson.get(`${tournament.id}:${person.id}`) ??
                allParticipants.find((p) => p.person.claimedByUserId === userId);
              const isMine = person.claimedByUserId === userId;
              const claimedByOther = !!person.claimedByUserId && !isMine;
              return (
                <li key={person.id.toString()} className="border-t border-border pt-5 first:border-t-0 first:pt-0">
                  <PersonHeader
                    person={person}
                    isMine={isMine}
                    claimedByOther={claimedByOther}
                  />
                  {participation ? (
                    <ParticipationDetails participation={participation} />
                  ) : (
                    <p className="mt-2 text-caption text-muted-foreground">
                      No participation row found yet — the speaker / participant tabs may not
                      have been ingested.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[14px] text-muted-foreground">
            The private URL landing page didn't say "Private URL for &lt;name&gt;". Pick
            yourself from the roster below.
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
              role:
                p.roles.map((r) => r.role).join(', ') ||
                (p.judgeTypeTag ? `Judge · ${p.judgeTypeTag}` : ''),
              teamName: p.teamName,
            }))}
            defaultOpen={!hasRegPeople}
          />
        ) : null}
      </CardBody>
    </Card>
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
        <span className="font-display text-[15px] font-semibold text-foreground">
          {person.displayName}
        </span>
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
    <details
      open={defaultOpen}
      className="group overflow-hidden rounded-card border border-border bg-muted/40"
    >
      <summary className="flex cursor-pointer select-none items-center justify-between gap-2 px-4 py-3 text-[13.5px] text-foreground">
        <span>
          {defaultOpen
            ? 'Pick yourself from the tournament roster'
            : "Can't find yourself? Pick from the roster"}
        </span>
        <span className="text-caption text-muted-foreground">
          {sorted.length} {sorted.length === 1 ? 'person' : 'people'}
          <span
            aria-hidden
            className="ml-2 inline-block transition-transform duration-[180ms] ease-soft group-open:rotate-180"
          >
            ▾
          </span>
        </span>
      </summary>
      <ul className="divide-y divide-border bg-card">
        {sorted.map((p) => (
          <li
            key={p.personId}
            className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]"
          >
            <div>
              <span className="text-foreground">{p.displayName}</span>
              {p.role ? <span className="ml-2 text-caption text-muted-foreground">{p.role}</span> : null}
              {p.teamName ? (
                <span className="ml-2 text-caption text-muted-foreground">· {p.teamName}</span>
              ) : null}
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
    judgeTypeTag: string | null;
    chairedPrelimRounds: number | null;
    lastOutroundChaired: string | null;
    lastOutroundPaneled: string | null;
    roles: { role: string }[];
    speakerRoundScores: {
      id: bigint;
      roundNumber: number;
      positionLabel: string | null;
      score: { toString(): string } | null;
    }[];
  };
}) {
  const rank = participation.eliminationReached
    ? rankForStage(participation.eliminationReached)
    : null;

  const isJudge =
    !!participation.judgeTypeTag || (participation.chairedPrelimRounds ?? 0) > 0;
  const isSpeaker = !!(participation.speakerScoreTotal || participation.teamName);

  return (
    <>
      <dl className="mt-3 grid grid-cols-2 gap-y-3 gap-x-6 text-[14px] sm:grid-cols-4">
        {participation.roles.length > 0 ? (
          <Field label="Roles" value={participation.roles.map((r) => r.role).join(', ')} />
        ) : null}

        {/* Judge fields */}
        {isJudge ? (
          <>
            {participation.judgeTypeTag ? (
              <Field label="Judge type" value={participation.judgeTypeTag} />
            ) : null}
            {(participation.chairedPrelimRounds ?? 0) > 0 ? (
              <Field label="Prelims chaired" value={String(participation.chairedPrelimRounds)} />
            ) : null}
            {participation.lastOutroundChaired ? (
              <Field label="Last outround (chair)" value={participation.lastOutroundChaired} />
            ) : null}
            {participation.lastOutroundPaneled && !participation.lastOutroundChaired ? (
              <Field label="Last outround (panel)" value={participation.lastOutroundPaneled} />
            ) : null}
          </>
        ) : null}

        {/* Speaker fields */}
        {isSpeaker || !isJudge ? (
          <>
            {participation.teamName ? (
              <Field label="Team" value={participation.teamName} />
            ) : null}
            {participation.speakerScoreTotal ? (
              <Field
                label="Speaker total"
                value={participation.speakerScoreTotal.toString()}
                mono
              />
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
              <div>
                <dt className="text-caption text-muted-foreground">Break</dt>
                <dd className="mt-0.5 flex items-center gap-2">
                  <span className="text-foreground">{participation.eliminationReached}</span>
                  <RankBadge rank={rank} />
                </dd>
              </div>
            ) : null}
          </>
        ) : null}
      </dl>

      {participation.speakerRoundScores.length > 0 ? (
        <details className="mt-4">
          <summary className="cursor-pointer text-caption text-muted-foreground hover:text-foreground">
            <span className="inline-flex items-center gap-2">
              <Award className="h-3.5 w-3.5" aria-hidden />
              Round-by-round scores
            </span>
          </summary>
          <div className="mt-2.5 overflow-hidden rounded-md border border-border">
            <table className="w-full text-caption">
              <thead className="bg-muted/60 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-semibold uppercase tracking-wider">Round</th>
                  <th className="px-3 py-2 font-semibold uppercase tracking-wider">Position</th>
                  <th className="px-3 py-2 font-semibold uppercase tracking-wider">Score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {participation.speakerRoundScores.map((s) => (
                  <tr key={s.id.toString()}>
                    <td className="px-3 py-1.5 text-foreground">{s.roundNumber}</td>
                    <td className="px-3 py-1.5 text-foreground">{s.positionLabel || '—'}</td>
                    <td className="px-3 py-1.5 font-mono text-foreground">
                      {s.score?.toString() ?? '—'}
                    </td>
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

/** Very rough stage → rank mapping. 1 = champion/GF, 2 = SF/finalist, 3 = QF, 4+ = Octos/R16 etc. */
function rankForStage(stage: string): number | null {
  const s = stage.toLowerCase();
  if (/champion|won|winner/.test(s)) return 1;
  if (/final/.test(s)) return s.includes('semi') ? 2 : s.includes('quarter') ? 3 : 1;
  if (/semi/.test(s)) return 2;
  if (/quarter/.test(s)) return 3;
  if (/octo|r16|round of 16/.test(s)) return 4;
  return null;
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className={'mt-0.5 text-foreground ' + (mono ? 'font-mono' : '')}>{value}</dd>
    </div>
  );
}

type ResultsTableRow = {
  tournamentId: bigint;
  tournamentName: string;
  year: number | null;
  format: string | null;
  sourceUrl: string;
  teamName: string | null;
  wins: number | null;
  losses: number | null;
  speakerScoreTotal: string | null;
  speakerRankOpen: number | null;
  eliminationReached: string | null;
  teamBreakRank: number | null;
  judgeTypeTag: string | null;
  chairedPrelimRounds: number | null;
  lastOutroundChaired: string | null;
  roles: string[];
};

function ResultsTable({ rows }: { rows: ResultsTableRow[] }) {
  const fmtRecord = (w: number | null, l: number | null) =>
    w == null && l == null ? '—' : `${w ?? '–'}–${l ?? '–'}`;
  const fmtBreak = (r: ResultsTableRow) =>
    r.eliminationReached
      ? r.teamBreakRank
        ? `${r.eliminationReached} (#${r.teamBreakRank})`
        : r.eliminationReached
      : '—';
  const fmtJudging = (r: ResultsTableRow) => {
    const parts: string[] = [];
    if (r.chairedPrelimRounds && r.chairedPrelimRounds > 0) {
      parts.push(`Chaired ${r.chairedPrelimRounds}`);
    }
    if (r.lastOutroundChaired) parts.push(r.lastOutroundChaired);
    if (r.judgeTypeTag) parts.push(r.judgeTypeTag);
    return parts.length ? parts.join(' · ') : '—';
  };
  return (
    <section className="space-y-3">
      <header className="flex items-baseline justify-between gap-3">
        <h2 className="inline-flex items-center gap-2 font-display text-h4 font-semibold text-foreground">
          <Trophy className="h-4 w-4 text-primary" aria-hidden />
          Results
        </h2>
        <span className="text-caption text-muted-foreground">
          {rows.length} {rows.length === 1 ? 'tournament' : 'tournaments'}
        </span>
      </header>

      {/* Desktop: wide table */}
      <div className="hidden overflow-x-auto rounded-card border border-border bg-card shadow-xs md:block">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-caption text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Tournament</th>
              <th className="px-3 py-2.5 font-medium">Year</th>
              <th className="px-3 py-2.5 font-medium">Format</th>
              <th className="px-3 py-2.5 font-medium">Team</th>
              <th className="px-3 py-2.5 font-medium">W–L</th>
              <th className="px-3 py-2.5 font-medium">Spkr score</th>
              <th className="px-3 py-2.5 font-medium">Spkr rank</th>
              <th className="px-3 py-2.5 font-medium">Break</th>
              <th className="px-3 py-2.5 font-medium">Judging</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((r) => (
              <tr key={r.tournamentId.toString()} className="hover:bg-muted/20">
                <td className="px-4 py-2.5">
                  <a
                    href={r.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-medium text-foreground hover:text-primary"
                  >
                    {r.tournamentName}
                  </a>
                </td>
                <td className="px-3 py-2.5 font-mono text-muted-foreground">
                  {r.year ?? '—'}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{r.format ?? '—'}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{r.teamName ?? '—'}</td>
                <td className="px-3 py-2.5 font-mono">{fmtRecord(r.wins, r.losses)}</td>
                <td className="px-3 py-2.5 font-mono">
                  {r.speakerScoreTotal ?? '—'}
                </td>
                <td className="px-3 py-2.5 font-mono">
                  {r.speakerRankOpen != null ? `#${r.speakerRankOpen}` : '—'}
                </td>
                <td className="px-3 py-2.5">{fmtBreak(r)}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{fmtJudging(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: stacked cards */}
      <ul className="space-y-2 md:hidden">
        {rows.map((r) => (
          <li
            key={r.tournamentId.toString()}
            className="rounded-card border border-border bg-card p-3 shadow-xs"
          >
            <div className="flex items-baseline justify-between gap-2">
              <a
                href={r.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate font-display text-[14.5px] font-semibold text-foreground"
              >
                {r.tournamentName}
              </a>
              <span className="whitespace-nowrap font-mono text-caption text-muted-foreground">
                {r.year ?? '—'}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-caption">
              {r.format ? <Field label="Format" value={r.format} /> : null}
              {r.teamName ? <Field label="Team" value={r.teamName} /> : null}
              <Field label="W–L" value={fmtRecord(r.wins, r.losses)} mono />
              {r.speakerScoreTotal ? (
                <Field label="Spkr score" value={r.speakerScoreTotal} mono />
              ) : null}
              {r.speakerRankOpen != null ? (
                <Field label="Spkr rank" value={`#${r.speakerRankOpen}`} mono />
              ) : null}
              {r.eliminationReached ? <Field label="Break" value={fmtBreak(r)} /> : null}
              {fmtJudging(r) !== '—' ? <Field label="Judging" value={fmtJudging(r)} /> : null}
            </dl>
          </li>
        ))}
      </ul>
    </section>
  );
}
