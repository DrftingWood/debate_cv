import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  Trophy,
  ExternalLink,
  Search,
  Mail,
  MapPin,
  Mic,
  Gavel,
  ChevronDown,
} from 'lucide-react';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { normalizePersonName } from '@/lib/calicotab/fingerprint';
import { Badge } from '@/components/ui/Badge';
import { EmptyState } from '@/components/ui/EmptyState';
import { Button } from '@/components/ui/Button';
import { ParticipantSearch } from '@/components/ParticipantSearch';

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

// Score outround stages so we can compute "deepest reached" by max rank.
// Higher = later in the bracket. Returns null for prelim rounds and unknown
// strings so the comparator skips them.
function outroundRank(stage: string | null | undefined): number | null {
  if (!stage) return null;
  const s = stage.toLowerCase();
  if (/grand\s*final|grand-final|\bgf\b/.test(s)) return 110;
  if (/\bfinals?\b|\bf\b(?!our)/.test(s) && !/quarter|semi|octo|partial|round/.test(s)) return 100;
  if (/semi[-\s]?final|semifinals?|\bsf\b/.test(s)) return 90;
  if (/quarter[-\s]?final|quarterfinals?|\bqf\b|\bquarters\b/.test(s)) return 80;
  if (/octo[-\s]?final|octofinals?|octofs|\bof\b|\boctos\b/.test(s)) return 70;
  if (/double\s*octo|doubles?\b/.test(s)) return 60;
  if (/triple\s*octo/.test(s)) return 50;
  if (/partial\s*double/.test(s)) return 55;
  if (/partial\s*triple/.test(s)) return 45;
  // "Round of 16/32" generic forms
  const ro = s.match(/round\s*of\s*(\d+)/);
  if (ro) {
    const n = Number(ro[1]);
    if (n === 2) return 100;
    if (n === 4) return 90;
    if (n === 8) return 80;
    if (n === 16) return 70;
    if (n === 32) return 60;
    if (n === 64) return 50;
  }
  return null;
}

export default async function CvPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/');
  const userId = session.user.id;

  // 1) Load user info, every URL the user has ingested, and every Person
  // they've claimed (one user can have multiple Persons across name aliases).
  const [user, urls, claimedPersons] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, image: true },
    }),
    prisma.discoveredUrl.findMany({
      where: { userId, tournamentId: { not: null } },
      include: { tournament: true },
    }),
    prisma.person.findMany({
      where: { claimedByUserId: userId },
      select: { id: true, displayName: true, normalizedName: true },
    }),
  ]);

  const claimedPersonIds = new Set(claimedPersons.map((p) => p.id));
  const tournamentIds = Array.from(
    new Set(urls.map((u) => u.tournamentId!).filter((id): id is bigint => id != null)),
  );

  // tournament metadata for table rows
  type TournamentMeta = NonNullable<(typeof urls)[number]['tournament']>;
  const tournamentById = new Map<bigint, TournamentMeta>();
  for (const u of urls) if (u.tournament) tournamentById.set(u.tournament.id, u.tournament);

  // Per-tournament registration name from the URL the user actually uploaded,
  // gated by whether that name is in their claimed-aliases set. Different
  // tournaments often spell the same person differently — show the spelling
  // that was on this tournament's private URL rather than a single canonical
  // name plastered across every row.
  const claimedNormalizedNames = new Set(claimedPersons.map((p) => p.normalizedName));
  const myNameByTournament = new Map<bigint, string>();
  for (const u of urls) {
    if (!u.tournamentId) continue;
    const reg = (u.registrationName ?? '').trim();
    if (!reg) continue;
    if (!claimedNormalizedNames.has(normalizePersonName(reg))) continue;
    myNameByTournament.set(u.tournamentId, reg);
  }

  // 2) All my participations across those tournaments. One per (tournament,
  // person) — when the user has both a registration placeholder Person and a
  // tab-side Person claimed for the same tournament, both show up here and
  // we collapse later.
  const myParticipations = tournamentIds.length
    ? await prisma.tournamentParticipant.findMany({
        where: {
          tournamentId: { in: tournamentIds },
          person: { claimedByUserId: userId },
        },
        include: {
          roles: true,
          // Pull the per-round scores so we can compute "average speaker
          // score per round" — the raw total has no meaning without N.
          speakerRoundScores: { select: { score: true } },
        },
      })
    : [];

  // 3) Fan out the auxiliary queries needed to fill the speaking + judging
  // tables. All run in parallel.
  const myTeamPairs = myParticipations
    .filter((p) => p.teamName)
    .map((p) => ({ tournamentId: p.tournamentId, teamName: p.teamName! }));
  const myTeamPairKeys = new Set(myTeamPairs.map((p) => `${p.tournamentId}:${p.teamName}`));

  const [teammateRows, teamResultRows, judgeAssignmentRows] = await Promise.all([
    myTeamPairs.length
      ? prisma.tournamentParticipant.findMany({
          where: {
            OR: myTeamPairs.map((p) => ({
              tournamentId: p.tournamentId,
              teamName: p.teamName,
            })),
            roles: { some: { role: 'speaker' } },
          },
          select: {
            tournamentId: true,
            teamName: true,
            personId: true,
            person: { select: { displayName: true } },
          },
        })
      : Promise.resolve([] as Array<{
          tournamentId: bigint;
          teamName: string | null;
          personId: bigint;
          person: { displayName: string };
        }>),
    myTeamPairs.length
      ? prisma.teamResult.findMany({
          where: {
            OR: myTeamPairs.map((p) => ({
              tournamentId: p.tournamentId,
              teamName: p.teamName,
              roundNumber: 0,
            })),
          },
          select: {
            tournamentId: true,
            teamName: true,
            wins: true,
            points: true,
          },
        })
      : Promise.resolve([] as Array<{
          tournamentId: bigint;
          teamName: string | null;
          wins: number | null;
          points: { toString(): string } | null;
        }>),
    myParticipations.length
      ? prisma.judgeAssignment.findMany({
          where: {
            tournamentId: { in: tournamentIds },
            personId: { in: Array.from(claimedPersonIds) },
          },
          select: {
            tournamentId: true,
            personId: true,
            stage: true,
            panelRole: true,
            roundNumber: true,
          },
        })
      : Promise.resolve([] as Array<{
          tournamentId: bigint;
          personId: bigint;
          stage: string | null;
          panelRole: string | null;
          roundNumber: number | null;
        }>),
  ]);

  // 4) Index aux data by lookup key.
  const teammatesByKey = new Map<string, string[]>();
  for (const tm of teammateRows) {
    if (!tm.teamName) continue;
    const key = `${tm.tournamentId}:${tm.teamName}`;
    if (!myTeamPairKeys.has(key)) continue;
    if (claimedPersonIds.has(tm.personId)) continue; // skip me / my aliases
    const list = teammatesByKey.get(key) ?? [];
    list.push(tm.person.displayName);
    teammatesByKey.set(key, list);
  }
  const teamPointsByKey = new Map<string, { wins: number | null; points: string | null }>();
  for (const tr of teamResultRows) {
    if (!tr.teamName) continue;
    teamPointsByKey.set(`${tr.tournamentId}:${tr.teamName}`, {
      wins: tr.wins,
      points: tr.points ? tr.points.toString() : null,
    });
  }

  // 5) Build speaker rows. One row per (tournamentId) where the user has a
  // speaker participation. Collapse multiple participations for the same
  // tournament (registration placeholder + tab row) by preferring the row
  // with actual scores.
  const speakerRichness = (p: (typeof myParticipations)[number]): number =>
    (p.speakerScoreTotal ? 4 : 0) +
    (p.teamName ? 2 : 0) +
    (p.eliminationReached ? 1 : 0);

  const myDisplayName = claimedPersons[0]?.displayName ?? user?.name ?? 'You';
  type SpeakerRow = {
    tournamentId: bigint;
    tournamentName: string;
    year: number | null;
    format: string | null;
    sourceUrl: string;
    myName: string;
    teammates: string[];
    teamName: string | null;
    teamPoints: string | null;
    teamWins: number | null;
    speakerAvgScore: string | null;
    prelimsSpoken: number;
    speakerRankOpen: number | null;
    speakerRankEsl: number | null;
    speakerRankEfl: number | null;
    teamBreakRank: number | null;
    eliminationReached: string | null;
  };
  const speakerByTournament = new Map<bigint, (typeof myParticipations)[number]>();
  for (const p of myParticipations) {
    const isSpeaker = p.roles.some((r) => r.role === 'speaker');
    if (!isSpeaker) continue;
    const existing = speakerByTournament.get(p.tournamentId);
    if (!existing || speakerRichness(p) > speakerRichness(existing)) {
      speakerByTournament.set(p.tournamentId, p);
    }
  }
  const speakerRows: SpeakerRow[] = [];
  for (const [tid, p] of speakerByTournament.entries()) {
    const t = tournamentById.get(tid);
    if (!t) continue;
    const teamKey = p.teamName ? `${tid}:${p.teamName}` : null;
    const tr = teamKey ? teamPointsByKey.get(teamKey) : null;

    // Per-round average — the only speaker-score number that makes sense to
    // compare across tournaments. Total varies with prelim count (5 rounds
    // vs 9 rounds), so a 600 at WUDC and a 350 at a 5-round IV both round
    // to ~74 average. Counts only rounds with an actual numeric score so
    // iron-manning / DNS rounds don't skew the average down.
    const numericScores = (p.speakerRoundScores ?? [])
      .map((s) => (s.score == null ? null : Number(s.score)))
      .filter((n): n is number => n != null && Number.isFinite(n));
    const prelimsSpoken = numericScores.length;
    const total = p.speakerScoreTotal ? Number(p.speakerScoreTotal) : null;
    let speakerAvgScore: string | null = null;
    if (prelimsSpoken > 0 && total != null && Number.isFinite(total)) {
      speakerAvgScore = (total / prelimsSpoken).toFixed(1);
    } else if (prelimsSpoken > 0 && numericScores.length > 0) {
      // Fall back to the per-round scores' own sum when speakerScoreTotal
      // wasn't populated by the tab parser.
      const sum = numericScores.reduce((a, b) => a + b, 0);
      speakerAvgScore = (sum / prelimsSpoken).toFixed(1);
    }

    speakerRows.push({
      tournamentId: tid,
      tournamentName: t.name,
      year: t.year,
      format: t.format,
      sourceUrl: t.sourceUrlRaw,
      myName: myNameByTournament.get(tid) ?? myDisplayName,
      teammates: teamKey ? (teammatesByKey.get(teamKey) ?? []) : [],
      teamName: p.teamName,
      teamPoints: tr?.points ?? null,
      teamWins: tr?.wins ?? p.wins ?? null,
      speakerAvgScore,
      prelimsSpoken,
      speakerRankOpen: p.speakerRankOpen,
      speakerRankEsl: p.speakerRankEsl,
      speakerRankEfl: p.speakerRankEfl,
      teamBreakRank: p.teamBreakRank,
      eliminationReached: p.eliminationReached,
    });
  }
  speakerRows.sort((a, b) => {
    const ya = a.year ?? -Infinity;
    const yb = b.year ?? -Infinity;
    if (ya !== yb) return yb - ya;
    return a.tournamentName.localeCompare(b.tournamentName);
  });

  // 6) Build judge rows. One row per tournament where the user judged.
  type JudgeRow = {
    tournamentId: bigint;
    tournamentName: string;
    year: number | null;
    format: string | null;
    sourceUrl: string;
    judgeTypeTag: string | null;
    roundsJudged: number;
    roundsChaired: number;
    deepestOutround: string | null;
    lastOutround: string | null;
    lastOutroundStatus: 'chaired' | 'paneled' | null;
  };
  const judgeByTournament = new Map<bigint, (typeof myParticipations)[number]>();
  for (const p of myParticipations) {
    const isJudge =
      p.roles.some((r) => r.role === 'judge') ||
      !!p.judgeTypeTag ||
      (p.chairedPrelimRounds ?? 0) > 0 ||
      !!p.lastOutroundChaired ||
      !!p.lastOutroundPaneled;
    if (!isJudge) continue;
    // Prefer the participation with the richer judging signal
    const existing = judgeByTournament.get(p.tournamentId);
    const score = (q: (typeof p) | undefined) =>
      !q
        ? -1
        : (q.judgeTypeTag ? 1 : 0) +
          (q.chairedPrelimRounds ?? 0) +
          (q.lastOutroundChaired ? 5 : 0) +
          (q.lastOutroundPaneled ? 3 : 0);
    if (!existing || score(p) > score(existing)) {
      judgeByTournament.set(p.tournamentId, p);
    }
  }

  // Aggregate judge assignments by (tournamentId, personId) for the user's
  // claimed personIds, then collapse to per-tournament across all personIds.
  type JudgeStats = {
    rounds: Set<string>; // distinct round identifiers
    chaired: number;
    deepestOutround: string | null;
    deepestOutroundRank: number;
  };
  const judgeStatsByTournament = new Map<bigint, JudgeStats>();
  for (const a of judgeAssignmentRows) {
    if (!claimedPersonIds.has(a.personId)) continue;
    let stats = judgeStatsByTournament.get(a.tournamentId);
    if (!stats) {
      stats = { rounds: new Set(), chaired: 0, deepestOutround: null, deepestOutroundRank: -1 };
      judgeStatsByTournament.set(a.tournamentId, stats);
    }
    stats.rounds.add(`${a.stage ?? ''}:${a.roundNumber ?? ''}`);
    if ((a.panelRole ?? '').toLowerCase().startsWith('chair')) stats.chaired++;
    const r = outroundRank(a.stage);
    if (r != null && r > stats.deepestOutroundRank) {
      stats.deepestOutroundRank = r;
      stats.deepestOutround = a.stage;
    }
  }

  const judgeRows: JudgeRow[] = [];
  for (const [tid, p] of judgeByTournament.entries()) {
    const t = tournamentById.get(tid);
    if (!t) continue;
    const stats = judgeStatsByTournament.get(tid);
    // last outround status: prefer chaired over paneled when both exist.
    let lastOutround: string | null = null;
    let lastOutroundStatus: 'chaired' | 'paneled' | null = null;
    if (p.lastOutroundChaired) {
      lastOutround = p.lastOutroundChaired;
      lastOutroundStatus = 'chaired';
    } else if (p.lastOutroundPaneled) {
      lastOutround = p.lastOutroundPaneled;
      lastOutroundStatus = 'paneled';
    }
    judgeRows.push({
      tournamentId: tid,
      tournamentName: t.name,
      year: t.year,
      format: t.format,
      sourceUrl: t.sourceUrlRaw,
      judgeTypeTag: p.judgeTypeTag,
      roundsJudged: stats?.rounds.size ?? 0,
      roundsChaired: p.chairedPrelimRounds ?? stats?.chaired ?? 0,
      deepestOutround: stats?.deepestOutround ?? lastOutround,
      lastOutround,
      lastOutroundStatus,
    });
  }
  judgeRows.sort((a, b) => {
    const ya = a.year ?? -Infinity;
    const yb = b.year ?? -Infinity;
    if (ya !== yb) return yb - ya;
    return a.tournamentName.localeCompare(b.tournamentName);
  });

  // 7) Tournaments where the user has a URL but no real tab participation
  // has been claimed yet (i.e. only the registration-side empty placeholder
  // is claimed, or nothing at all). These need the search-based claim flow
  // so the user can manually pick themselves from the tournament's roster.
  const matchedTournamentIds = new Set<bigint>([
    ...speakerRows.map((r) => r.tournamentId),
    ...judgeRows.map((r) => r.tournamentId),
  ]);
  const unmatched = tournamentIds
    .map((tid) => tournamentById.get(tid))
    .filter((t): t is TournamentMeta => !!t)
    .filter((t) => !matchedTournamentIds.has(t.id))
    .sort((a, b) => {
      const ya = a.year ?? -Infinity;
      const yb = b.year ?? -Infinity;
      if (ya !== yb) return yb - ya;
      return a.name.localeCompare(b.name);
    });

  // 8) Header summary
  const totalTournaments = tournamentIds.length;
  const breaks = speakerRows.filter((r) => r.eliminationReached).length;
  const totalRoundsChaired = judgeRows.reduce((s, r) => s + (r.roundsChaired ?? 0), 0);

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
            <MetricTile label="Tournaments" value={totalTournaments} />
            <MetricTile label="Breaks" value={breaks} accent />
            <MetricTile label="Prelims chaired" value={totalRoundsChaired} mono />
          </div>
        </div>
      </header>

      {/* Summary row */}
      <div className="flex flex-wrap items-center gap-2 text-caption">
        <Badge variant="outline">{totalTournaments} tournaments</Badge>
        <Badge variant={speakerRows.length > 0 ? 'success' : 'neutral'}>
          {speakerRows.length} as speaker
        </Badge>
        <Badge variant={judgeRows.length > 0 ? 'info' : 'neutral'}>
          {judgeRows.length} as judge
        </Badge>
        <Link href="/cv/verify">
          <Button variant="outline" size="sm">Verify extracted fields</Button>
        </Link>
      </div>

      {totalTournaments === 0 ? (
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
        <>
          <CollapsibleSection
            title="Speaking"
            count={speakerRows.length}
            icon={<Mic className="h-4 w-4 text-primary" aria-hidden />}
            defaultOpen
          >
            {speakerRows.length > 0 ? (
              <SpeakingTable rows={speakerRows} />
            ) : (
              <p className="p-5 text-caption text-muted-foreground">
                No speaker results yet for tournaments you've been identified in.
              </p>
            )}
          </CollapsibleSection>

          <CollapsibleSection
            title="Judging"
            count={judgeRows.length}
            icon={<Gavel className="h-4 w-4 text-primary" aria-hidden />}
            defaultOpen
          >
            {judgeRows.length > 0 ? (
              <JudgingTable rows={judgeRows} />
            ) : (
              <p className="p-5 text-caption text-muted-foreground">
                No judging history yet for tournaments you've been identified in.
              </p>
            )}
          </CollapsibleSection>

          {unmatched.length > 0 ? (
            <CollapsibleSection
              title="Find me in tournaments"
              count={unmatched.length}
              icon={<Search className="h-4 w-4 text-primary" aria-hidden />}
              defaultOpen={false}
            >
              <ul className="divide-y divide-border">
                {unmatched.map((t) => (
                  <li key={t.id.toString()} className="space-y-3 p-5 md:p-6">
                    <header className="flex flex-wrap items-baseline justify-between gap-3">
                      <div>
                        <a
                          href={t.sourceUrlRaw}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-display text-[15px] font-semibold text-foreground hover:text-primary"
                        >
                          {t.name}
                        </a>
                        <span className="ml-2 font-mono text-caption text-muted-foreground">
                          {t.year ?? ''}
                        </span>
                      </div>
                      {t.format ? (
                        <Badge variant="outline">{t.format}</Badge>
                      ) : null}
                    </header>
                    <ParticipantSearch
                      tournamentId={t.id.toString()}
                      tournamentName={t.name}
                    />
                  </li>
                ))}
              </ul>
            </CollapsibleSection>
          ) : null}
        </>
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

function CollapsibleSection({
  title,
  count,
  icon,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  icon: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      className="group overflow-hidden rounded-card border border-border bg-card/60 shadow-xs"
    >
      <summary className="flex cursor-pointer select-none items-center justify-between gap-3 px-5 py-4 md:px-6">
        <div className="inline-flex items-center gap-2">
          {icon}
          <h2 className="font-display text-h4 font-semibold text-foreground">{title}</h2>
          <Badge variant="neutral">{count}</Badge>
        </div>
        <ChevronDown
          className="h-4 w-4 text-muted-foreground transition-transform duration-[180ms] ease-soft group-open:rotate-180"
          aria-hidden
        />
      </summary>
      <div className="border-t border-border">{children}</div>
    </details>
  );
}

// Pretty-print speaker rank columns: "#5 Open · #3 ESL"
function fmtSpeakerRanks(r: {
  speakerRankOpen: number | null;
  speakerRankEsl: number | null;
  speakerRankEfl: number | null;
}): string {
  const parts: string[] = [];
  if (r.speakerRankOpen != null) parts.push(`#${r.speakerRankOpen} Open`);
  if (r.speakerRankEsl != null) parts.push(`#${r.speakerRankEsl} ESL`);
  if (r.speakerRankEfl != null) parts.push(`#${r.speakerRankEfl} EFL`);
  return parts.join(' · ') || '—';
}

function fmtBreak(r: {
  eliminationReached: string | null;
  teamBreakRank: number | null;
}): string {
  if (!r.eliminationReached && r.teamBreakRank == null) return '—';
  if (r.eliminationReached && r.teamBreakRank != null) {
    return `${r.eliminationReached} · #${r.teamBreakRank}`;
  }
  return r.eliminationReached ?? `#${r.teamBreakRank}`;
}

type SpeakingTableRow = {
  tournamentId: bigint;
  tournamentName: string;
  year: number | null;
  format: string | null;
  sourceUrl: string;
  myName: string;
  teammates: string[];
  teamName: string | null;
  teamPoints: string | null;
  teamWins: number | null;
  speakerAvgScore: string | null;
  prelimsSpoken: number;
  speakerRankOpen: number | null;
  speakerRankEsl: number | null;
  speakerRankEfl: number | null;
  teamBreakRank: number | null;
  eliminationReached: string | null;
};

function SpeakingTable({ rows }: { rows: SpeakingTableRow[] }) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-caption text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Tournament</th>
              <th className="px-3 py-2.5 font-medium">Year</th>
              <th className="px-3 py-2.5 font-medium">Format</th>
              <th className="px-3 py-2.5 font-medium">My name</th>
              <th className="px-3 py-2.5 font-medium">Teammate(s)</th>
              <th className="px-3 py-2.5 font-medium">Team</th>
              <th className="px-3 py-2.5 font-medium">Team points</th>
              <th className="px-3 py-2.5 font-medium" title="Average speaker score per prelim round spoken">Spkr avg</th>
              <th className="px-3 py-2.5 font-medium">Rank</th>
              <th className="px-3 py-2.5 font-medium">Break</th>
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
                <td className="px-3 py-2.5 font-mono text-muted-foreground">{r.year ?? '—'}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{r.format ?? '—'}</td>
                <td className="px-3 py-2.5">{r.myName}</td>
                <td className="px-3 py-2.5 text-muted-foreground">
                  {r.teammates.length ? r.teammates.join(', ') : '—'}
                </td>
                <td className="px-3 py-2.5 text-muted-foreground">{r.teamName ?? '—'}</td>
                <td className="px-3 py-2.5 font-mono">
                  {r.teamPoints ?? (r.teamWins != null ? `${r.teamWins}W` : '—')}
                </td>
                <td
                  className="px-3 py-2.5 font-mono"
                  title={
                    r.speakerAvgScore
                      ? `Average across ${r.prelimsSpoken} prelim ${r.prelimsSpoken === 1 ? 'round' : 'rounds'}`
                      : ''
                  }
                >
                  {r.speakerAvgScore ?? '—'}
                </td>
                <td className="px-3 py-2.5">{fmtSpeakerRanks(r)}</td>
                <td className="px-3 py-2.5">{fmtBreak(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile stacked cards */}
      <ul className="divide-y divide-border md:hidden">
        {rows.map((r) => (
          <li key={r.tournamentId.toString()} className="space-y-2 p-4">
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
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-caption">
              {r.format ? <Field label="Format" value={r.format} /> : null}
              <Field label="My name" value={r.myName} />
              {r.teammates.length ? <Field label="Teammates" value={r.teammates.join(', ')} /> : null}
              {r.teamName ? <Field label="Team" value={r.teamName} /> : null}
              {r.teamPoints ? <Field label="Team points" value={r.teamPoints} mono /> : null}
              {r.speakerAvgScore ? (
                <Field
                  label={`Spkr avg (${r.prelimsSpoken} ${r.prelimsSpoken === 1 ? 'round' : 'rounds'})`}
                  value={r.speakerAvgScore}
                  mono
                />
              ) : null}
              {fmtSpeakerRanks(r) !== '—' ? <Field label="Rank" value={fmtSpeakerRanks(r)} /> : null}
              {fmtBreak(r) !== '—' ? <Field label="Break" value={fmtBreak(r)} /> : null}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

type JudgingTableRow = {
  tournamentId: bigint;
  tournamentName: string;
  year: number | null;
  format: string | null;
  sourceUrl: string;
  judgeTypeTag: string | null;
  roundsJudged: number;
  roundsChaired: number;
  deepestOutround: string | null;
  lastOutround: string | null;
  lastOutroundStatus: 'chaired' | 'paneled' | null;
};

function JudgingTable({ rows }: { rows: JudgingTableRow[] }) {
  const fmtLast = (r: JudgingTableRow) =>
    r.lastOutround ? `${r.lastOutround} (${r.lastOutroundStatus ?? '—'})` : '—';
  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-[13.5px]">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-left text-caption text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">Tournament</th>
              <th className="px-3 py-2.5 font-medium">Year</th>
              <th className="px-3 py-2.5 font-medium">Format</th>
              <th className="px-3 py-2.5 font-medium">Judge type</th>
              <th className="px-3 py-2.5 font-medium">Rounds judged</th>
              <th className="px-3 py-2.5 font-medium">Rounds chaired</th>
              <th className="px-3 py-2.5 font-medium">Deepest outround</th>
              <th className="px-3 py-2.5 font-medium">Last outround</th>
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
                <td className="px-3 py-2.5 font-mono text-muted-foreground">{r.year ?? '—'}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{r.format ?? '—'}</td>
                <td className="px-3 py-2.5 text-muted-foreground">{r.judgeTypeTag ?? '—'}</td>
                <td className="px-3 py-2.5 font-mono">{r.roundsJudged || '—'}</td>
                <td className="px-3 py-2.5 font-mono">{r.roundsChaired || '—'}</td>
                <td className="px-3 py-2.5">{r.deepestOutround ?? '—'}</td>
                <td className="px-3 py-2.5">{fmtLast(r)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-border md:hidden">
        {rows.map((r) => (
          <li key={r.tournamentId.toString()} className="space-y-2 p-4">
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
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-caption">
              {r.format ? <Field label="Format" value={r.format} /> : null}
              {r.judgeTypeTag ? <Field label="Judge type" value={r.judgeTypeTag} /> : null}
              {r.roundsJudged ? <Field label="Rounds judged" value={String(r.roundsJudged)} mono /> : null}
              {r.roundsChaired ? <Field label="Rounds chaired" value={String(r.roundsChaired)} mono /> : null}
              {r.deepestOutround ? <Field label="Deepest outround" value={r.deepestOutround} /> : null}
              {r.lastOutround ? <Field label="Last outround" value={fmtLast(r)} /> : null}
            </dl>
          </li>
        ))}
      </ul>
    </>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <dt className="text-caption text-muted-foreground">{label}</dt>
      <dd className={'mt-0.5 text-foreground ' + (mono ? 'font-mono' : '')}>{value}</dd>
    </div>
  );
}
