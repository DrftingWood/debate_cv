import { prisma } from '@/lib/db';
import { normalizePersonName } from '@/lib/calicotab/fingerprint';
import { classifyRoundLabel, deepestOutroundAcrossRoles, outroundRank } from '@/lib/calicotab/judgeStats';
import { mergeSpeakerCvSignals } from '@/lib/cv/speakerSignals';
import { buildTeamRankLookup, teamResultKey } from '@/lib/cv/teamRanks';

// Shared CV data builder used by both the /cv page and the /api/cv/export
// CSV route. Pulling this out of the page keeps both consumers in lock-step:
// any field added to the row types is automatically available to both, and
// aggregation rules (broke detection, average-score logic, dedup of
// duplicate participations) live in one place instead of drifting.

export type CvSpeakerRoundScore = {
  roundNumber: number;
  positionLabel: string | null;
  score: number | null;
};

export type CvSpeakerRow = {
  tournamentId: bigint;
  tournamentName: string;
  year: number | null;
  format: string | null;
  totalTeams: number | null;
  sourceUrl: string;
  myName: string;
  teammates: string[];
  teamName: string | null;
  teamRank: number | null;
  teamPoints: string | null;
  teamWins: number | null;
  speakerAvgScore: string | null;
  prelimsSpoken: number;
  speakerRankOpen: number | null;
  speakerRankEsl: number | null;
  speakerRankEfl: number | null;
  teamBreakRank: number | null;
  eliminationReached: string | null;
  broke: boolean;
  /**
   * True when the user's team won the deepest outround they reached AND
   * that outround was the tournament's final (Grand Final / Final). Lets
   * the CV mark champions distinctly from "reached GF but lost". Null
   * when we have no team win/loss data for that outround (older ingests).
   */
  wonTournament: boolean | null;
  /**
   * True if the user has at least one open or acknowledged CvErrorReport
   * referencing this tournament. Lets the CV row show a small "Reported"
   * badge so the user remembers they've already flagged it (and doesn't
   * file a duplicate). Hidden once the report is fixed/won't_fix.
   */
  hasOpenReport: boolean;
  /** Per-round speaker scores for the expandable row UI. */
  roundScores: CvSpeakerRoundScore[];
};

export type CvJudgeRow = {
  tournamentId: bigint;
  tournamentName: string;
  year: number | null;
  format: string | null;
  totalTeams: number | null;
  sourceUrl: string;
  myName: string;
  judgeTypeTag: string | null;
  inroundsJudged: number | null;
  inroundsChaired: number | null;
  lastOutroundChaired: string | null;
  lastOutroundJudged: string | null;
  broke: boolean;
  /** Same semantics as CvSpeakerRow.hasOpenReport. */
  hasOpenReport: boolean;
};

export type CvUnmatchedTournament = {
  id: bigint;
  name: string;
  year: number | null;
  format: string | null;
  sourceUrlRaw: string;
};

export type CvHighlights = {
  /** Tournaments where the user's team won the GF (wonTournament === true). */
  championships: { tournamentName: string; year: number | null }[];
  /** Top-percentile speaker breaks (rank ≤ ceil(totalTeams * 0.10)). */
  topBreaks: {
    tournamentName: string;
    year: number | null;
    rank: number;
    totalTeams: number;
  }[];
  /** Single best Open speaker rank across all tournaments. */
  bestSpeakerRank: { tournamentName: string; year: number | null; rank: number } | null;
  /** Single highest speaker average across all tournaments. */
  bestSpeakerAverage: {
    tournamentName: string;
    year: number | null;
    score: number;
  } | null;
  /** Outrounds chaired (count of judge rows with lastOutroundChaired set). */
  outroundsChaired: number;
  /** Detected major-circuit events the user has attended (WUDC / EUDC / Australs / Worlds). */
  majorEvents: { tournamentName: string; year: number | null }[];
  /** Earliest and latest year with at least one row. */
  activeYears: { from: number; to: number } | null;
};

export type CvData = {
  user: { name: string | null; email: string | null; image: string | null } | null;
  myDisplayName: string;
  speakerRows: CvSpeakerRow[];
  judgeRows: CvJudgeRow[];
  unmatchedTournaments: CvUnmatchedTournament[];
  summary: {
    totalTournaments: number;
    breaks: number;
    totalRoundsChaired: number;
  };
  highlights: CvHighlights;
};

export async function buildCvData(userId: string): Promise<CvData> {
  const [user, urls, claimedPersons] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, image: true },
    }),
    prisma.discoveredUrl.findMany({
      // ingestedAt: not null filters out URLs that were assigned a
      // tournamentId mid-pipeline (e.g. cache-stale path set the link
      // but the parse later failed) but never finished ingesting. Without
      // this filter such URLs leak into the CV as rows with all-null
      // fields and confuse the user (audit issue #7).
      where: {
        userId,
        tournamentId: { not: null },
        ingestedAt: { not: null },
      },
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

  type TournamentMeta = NonNullable<(typeof urls)[number]['tournament']>;
  const tournamentById = new Map<bigint, TournamentMeta>();
  for (const u of urls) if (u.tournament) tournamentById.set(u.tournament.id, u.tournament);

  // Per-tournament registration name from the URL the user actually uploaded,
  // gated by whether that name is in their claimed-aliases set. Different
  // tournaments often spell the same person differently — show the spelling
  // that was on this tournament's private URL rather than a single canonical
  // name plastered across every row. Sort by URL so the picked spelling is
  // deterministic across page loads.
  const claimedNormalizedNames = new Set(claimedPersons.map((p) => p.normalizedName));
  const myNameByTournament = new Map<bigint, string>();
  for (const u of [...urls].sort((a, b) => a.url.localeCompare(b.url))) {
    if (!u.tournamentId || myNameByTournament.has(u.tournamentId)) continue;
    const reg = (u.registrationName ?? '').trim();
    if (!reg) continue;
    if (!claimedNormalizedNames.has(normalizePersonName(reg))) continue;
    myNameByTournament.set(u.tournamentId, reg);
  }

  const myParticipations = tournamentIds.length
    ? await prisma.tournamentParticipant.findMany({
        where: {
          tournamentId: { in: tournamentIds },
          person: { claimedByUserId: userId },
        },
        include: {
          roles: true,
          speakerRoundScores: {
            select: { roundNumber: true, positionLabel: true, score: true },
          },
        },
      })
    : [];

  const myTeamPairs = myParticipations
    .filter((p) => p.teamName)
    .map((p) => ({ tournamentId: p.tournamentId, teamName: p.teamName! }));
  const myTeamPairKeys = new Set(myTeamPairs.map((p) => `${p.tournamentId}:${p.teamName}`));

  // Distinct prelim round count per tournament. Used as a divisor when the
  // speaker tab gave us `speakerScoreTotal` but no per-round columns (an AP
  // tab pattern where round headers are bare digits or are simply not
  // released, so we have a total but can't count speeches directly).
  const prelimRoundCountByTournament = new Map<bigint, number>();
  if (tournamentIds.length > 0) {
    const rows = await prisma.teamResult.groupBy({
      by: ['tournamentId'],
      where: { tournamentId: { in: tournamentIds }, roundNumber: { gt: 0 } },
      _max: { roundNumber: true },
    });
    for (const r of rows) {
      const max = r._max.roundNumber;
      if (max != null && max > 0) prelimRoundCountByTournament.set(r.tournamentId, max);
    }
  }

  const [teammateRows, teamResultRows, judgeAssignmentRows, adjudicatorBreakRows] = await Promise.all([
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
    tournamentIds.length
      ? prisma.teamResult.findMany({
          where: { tournamentId: { in: tournamentIds }, roundNumber: 0 },
          select: { tournamentId: true, teamName: true, rank: true, wins: true, points: true },
        })
      : Promise.resolve([] as Array<{
          tournamentId: bigint;
          teamName: string | null;
          rank: number | null;
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
    tournamentIds.length
      ? prisma.eliminationResult.findMany({
          where: { tournamentId: { in: tournamentIds }, entityType: 'adjudicator' },
          select: { tournamentId: true, entityName: true, stage: true },
        })
      : Promise.resolve([] as Array<{
          tournamentId: bigint;
          entityName: string;
          stage: string;
        }>),
  ]);

  // Outround team win/loss results, indexed by (tid, teamName, stage). Used
  // to compute `wonTournament` per speaker row — i.e. did the user's team
  // win the deepest outround they reached, and was that outround the GF.
  const teamOutroundResultByKey = new Map<string, 'won' | 'lost'>();
  if (tournamentIds.length > 0) {
    const rows = await prisma.eliminationResult.findMany({
      where: {
        tournamentId: { in: tournamentIds },
        entityType: 'team',
        result: { in: ['won', 'lost'] },
      },
      select: { tournamentId: true, entityName: true, stage: true, result: true },
    });
    for (const r of rows) {
      teamOutroundResultByKey.set(
        `${r.tournamentId}:${r.entityName}:${r.stage}`,
        r.result as 'won' | 'lost',
      );
    }
  }

  // Tournaments the user has filed an unresolved (open or acknowledged)
  // CvErrorReport against. Lets the per-row "Reported" badge render so the
  // user remembers they already flagged the row. Resolved reports
  // (fixed/wont_fix) intentionally don't gate the badge — once the report
  // is closed, the row goes back to its baseline appearance.
  const reportedTournamentIds = new Set<string>();
  if (tournamentIds.length > 0) {
    const openReports = await prisma.cvErrorReport.findMany({
      where: { userId, status: { in: ['open', 'acknowledged'] } },
      select: { tournamentIds: true },
    });
    const tournamentIdSet = new Set(tournamentIds.map((id) => id.toString()));
    for (const r of openReports) {
      for (const id of r.tournamentIds) {
        if (tournamentIdSet.has(id)) reportedTournamentIds.add(id);
      }
    }
  }

  const teammatesByKey = new Map<string, string[]>();
  for (const tm of teammateRows) {
    if (!tm.teamName) continue;
    const key = `${tm.tournamentId}:${tm.teamName}`;
    if (!myTeamPairKeys.has(key)) continue;
    if (claimedPersonIds.has(tm.personId)) continue;
    const list = teammatesByKey.get(key) ?? [];
    list.push(tm.person.displayName);
    teammatesByKey.set(key, list);
  }

  const teamPointsByKey = new Map<string, { rank: number | null; wins: number | null; points: string | null }>();
  for (const tr of teamResultRows) {
    if (!tr.teamName) continue;
    const key = teamResultKey(tr.tournamentId, tr.teamName);
    if (!myTeamPairKeys.has(key)) continue;
    teamPointsByKey.set(key, {
      rank: tr.rank,
      wins: tr.wins,
      points: tr.points ? tr.points.toString() : null,
    });
  }
  const teamRankByKey = buildTeamRankLookup(teamResultRows);

  const judgeBrokeTournaments = new Set<bigint>();
  if (claimedPersons.length > 0 && adjudicatorBreakRows.length > 0) {
    const myNormalizedNames = new Set(claimedPersons.map((p) => p.normalizedName));
    for (const row of adjudicatorBreakRows) {
      if (myNormalizedNames.has(normalizePersonName(row.entityName))) {
        judgeBrokeTournaments.add(row.tournamentId);
      }
    }
  }

  // ── Speaker rows ─────────────────────────────────────────────────────────
  const speakerRichness = (p: (typeof myParticipations)[number]): number =>
    (p.speakerScoreTotal ? 4 : 0) + (p.teamName ? 2 : 0) + (p.eliminationReached ? 1 : 0);

  const myDisplayName = claimedPersons[0]?.displayName ?? user?.name ?? 'You';

  const speakerByTournament = new Map<bigint, (typeof myParticipations)[number]>();
  const speakerParticipationsByTournament = new Map<bigint, (typeof myParticipations)[number][]>();
  for (const p of myParticipations) {
    if (!p.roles.some((r) => r.role === 'speaker')) continue;
    const list = speakerParticipationsByTournament.get(p.tournamentId) ?? [];
    list.push(p);
    speakerParticipationsByTournament.set(p.tournamentId, list);
    const existing = speakerByTournament.get(p.tournamentId);
    if (!existing || speakerRichness(p) > speakerRichness(existing)) {
      speakerByTournament.set(p.tournamentId, p);
    }
  }

  const speakerRows: CvSpeakerRow[] = [];
  for (const [tid, p] of speakerByTournament.entries()) {
    const t = tournamentById.get(tid);
    if (!t) continue;
    const teamKey = p.teamName ? teamResultKey(tid, p.teamName) : null;
    const tr = teamKey ? teamPointsByKey.get(teamKey) : null;
    const speakerParticipations = speakerParticipationsByTournament.get(tid) ?? [p];
    const speakerSignals = mergeSpeakerCvSignals(speakerParticipations);

    const averageScore = (p.speakerRoundScores ?? []).find(
      (s) => s.roundNumber === 0 || s.positionLabel === 'average',
    );
    const averageScoreValue = averageScore?.score == null ? null : Number(averageScore.score);
    const numericScores = (p.speakerRoundScores ?? [])
      .filter((s) => s.roundNumber !== 0 && s.positionLabel !== 'average')
      .map((s) => (s.score == null ? null : Number(s.score)))
      .filter((n): n is number => n != null && Number.isFinite(n));
    const prelimsSpoken = numericScores.length;
    const total = p.speakerScoreTotal ? Number(p.speakerScoreTotal) : null;
    let speakerAvgScore: string | null = null;
    if (averageScoreValue != null && Number.isFinite(averageScoreValue)) {
      speakerAvgScore = averageScoreValue.toFixed(1);
    } else if (prelimsSpoken > 0 && total != null && Number.isFinite(total)) {
      speakerAvgScore = (total / prelimsSpoken).toFixed(1);
    } else if (prelimsSpoken > 0) {
      const sum = numericScores.reduce((a, b) => a + b, 0);
      speakerAvgScore = (sum / prelimsSpoken).toFixed(1);
    } else if (total != null && Number.isFinite(total)) {
      // Last-resort fallback for AP speaker tabs that exposed only `Total`
      // (so `speakerScoreTotal` is set) without a per-round breakdown. Use
      // the tournament's prelim round count as the divisor — a one-speech-
      // per-round approximation that's accurate for non-iron-manning AP/BP
      // speakers and beats showing nothing at all.
      const prelimCount = prelimRoundCountByTournament.get(tid);
      if (prelimCount != null && prelimCount > 0) {
        speakerAvgScore = (total / prelimCount).toFixed(1);
      }
    }

    // Champion check: did the user's team win the deepest outround they
    // reached, AND was that outround the tournament's final? Anything
    // shallower (e.g. winning Semis but losing GF) doesn't count as winning
    // the tournament — Semis-win is implied by having reached GF at all.
    // Reuse outroundRank's stage classification so "Quarterfinal" (which
    // contains the substring "final") is correctly excluded.
    let wonTournament: boolean | null = null;
    if (p.teamName && speakerSignals.eliminationReached) {
      const deepest = speakerSignals.eliminationReached;
      const stageRank = outroundRank({ roundLabel: deepest, roundNumber: null, isOutround: true });
      const isFinalStage = stageRank >= 95; // GF=100, plain Final=95
      if (isFinalStage) {
        const result = teamOutroundResultByKey.get(`${tid}:${p.teamName}:${deepest}`);
        if (result === 'won') wonTournament = true;
        else if (result === 'lost') wonTournament = false;
      }
    }

    speakerRows.push({
      tournamentId: tid,
      tournamentName: t.name,
      year: t.year,
      format: t.format,
      totalTeams: t.totalTeams,
      sourceUrl: t.sourceUrlRaw,
      myName: myNameByTournament.get(tid) ?? myDisplayName,
      teammates: teamKey ? (teammatesByKey.get(teamKey) ?? []) : [],
      teamName: p.teamName,
      teamRank: teamKey ? (teamRankByKey.get(teamKey) ?? null) : null,
      teamPoints: tr?.points ?? null,
      teamWins: tr?.wins ?? p.wins ?? null,
      speakerAvgScore,
      prelimsSpoken,
      speakerRankOpen: p.speakerRankOpen,
      speakerRankEsl: p.speakerRankEsl,
      speakerRankEfl: p.speakerRankEfl,
      teamBreakRank: speakerSignals.teamBreakRank,
      eliminationReached: speakerSignals.eliminationReached,
      broke: speakerSignals.broke,
      wonTournament,
      hasOpenReport: reportedTournamentIds.has(tid.toString()),
      roundScores: (p.speakerRoundScores ?? [])
        .filter((s) => s.roundNumber > 0)
        .map((s) => ({
          roundNumber: s.roundNumber,
          positionLabel: s.positionLabel,
          score: s.score == null ? null : Number(s.score),
        }))
        .sort((a, b) => a.roundNumber - b.roundNumber),
    });
  }
  speakerRows.sort((a, b) => {
    const ya = a.year ?? -Infinity;
    const yb = b.year ?? -Infinity;
    if (ya !== yb) return yb - ya;
    return a.tournamentName.localeCompare(b.tournamentName);
  });

  // ── Judge rows ───────────────────────────────────────────────────────────
  const judgeByTournament = new Map<bigint, (typeof myParticipations)[number]>();
  for (const p of myParticipations) {
    const isJudge =
      p.roles.some((r) => r.role === 'judge') ||
      !!p.judgeTypeTag ||
      (p.chairedPrelimRounds ?? 0) > 0 ||
      !!p.lastOutroundChaired ||
      !!p.lastOutroundPaneled;
    if (!isJudge) continue;
    const existing = judgeByTournament.get(p.tournamentId);
    const score = (q: (typeof p) | undefined) =>
      !q
        ? -1
        : (q.judgeTypeTag ? 1 : 0) +
          (q.chairedPrelimRounds ?? 0) +
          (q.lastOutroundChaired ? 5 : 0) +
          (q.lastOutroundPaneled ? 3 : 0);
    if (!existing || score(p) > score(existing)) judgeByTournament.set(p.tournamentId, p);
  }

  const judgeInroundsByTournament = new Map<bigint, Set<string>>();
  for (const a of judgeAssignmentRows) {
    if (!claimedPersonIds.has(a.personId)) continue;
    if (classifyRoundLabel(a.stage) !== 'inround') continue;
    const set = judgeInroundsByTournament.get(a.tournamentId) ?? new Set<string>();
    set.add(`${a.stage ?? ''}:${a.roundNumber ?? ''}`);
    judgeInroundsByTournament.set(a.tournamentId, set);
  }

  const judgeRows: CvJudgeRow[] = [];
  for (const [tid, p] of judgeByTournament.entries()) {
    const t = tournamentById.get(tid);
    if (!t) continue;
    const stats = judgeInroundsByTournament.get(tid);
    const lastOutroundJudged = deepestOutroundAcrossRoles(
      p.lastOutroundChaired,
      p.lastOutroundPaneled,
    );
    judgeRows.push({
      tournamentId: tid,
      tournamentName: t.name,
      year: t.year,
      format: t.format,
      totalTeams: t.totalTeams,
      sourceUrl: t.sourceUrlRaw,
      myName: myNameByTournament.get(tid) ?? myDisplayName,
      judgeTypeTag: p.judgeTypeTag,
      inroundsJudged: stats ? stats.size : null,
      inroundsChaired: p.chairedPrelimRounds,
      lastOutroundChaired: p.lastOutroundChaired ?? null,
      lastOutroundJudged,
      broke: !!lastOutroundJudged || judgeBrokeTournaments.has(tid),
      hasOpenReport: reportedTournamentIds.has(tid.toString()),
    });
  }
  judgeRows.sort((a, b) => {
    const ya = a.year ?? -Infinity;
    const yb = b.year ?? -Infinity;
    if (ya !== yb) return yb - ya;
    return a.tournamentName.localeCompare(b.tournamentName);
  });

  // ── Unmatched tournaments ────────────────────────────────────────────────
  const matchedTournamentIds = new Set<bigint>([
    ...speakerRows.map((r) => r.tournamentId),
    ...judgeRows.map((r) => r.tournamentId),
  ]);
  const unmatchedTournaments: CvUnmatchedTournament[] = tournamentIds
    .map((tid) => tournamentById.get(tid))
    .filter((t): t is TournamentMeta => !!t)
    .filter((t) => !matchedTournamentIds.has(t.id))
    .map((t) => ({
      id: t.id,
      name: t.name,
      year: t.year,
      format: t.format,
      sourceUrlRaw: t.sourceUrlRaw,
    }))
    .sort((a, b) => {
      const ya = a.year ?? -Infinity;
      const yb = b.year ?? -Infinity;
      if (ya !== yb) return yb - ya;
      return a.name.localeCompare(b.name);
    });

  const totalTournaments = tournamentIds.length;
  const breaks =
    speakerRows.filter((r) => r.broke).length + judgeRows.filter((r) => r.broke).length;
  const totalRoundsChaired = judgeRows.reduce((s, r) => s + (r.inroundsChaired ?? 0), 0);

  // ── Highlights ───────────────────────────────────────────────────────
  // Auto-derived achievements surfaced above the tables on /cv. Pure
  // functions of the rows we already computed; no extra DB hits.
  const MAJOR_PATTERN =
    /\b(?:wudc|world(?: university)? debating|eudc|european debating|australs|asian debating|naudc|north american debating)\b/i;

  const championships = speakerRows
    .filter((r) => r.wonTournament === true)
    .map((r) => ({ tournamentName: r.tournamentName, year: r.year }))
    .slice(0, 5);

  const topBreaks = speakerRows
    .filter(
      (r) =>
        r.broke &&
        r.speakerRankOpen != null &&
        r.totalTeams != null &&
        r.totalTeams > 0 &&
        r.speakerRankOpen <= Math.ceil(r.totalTeams * 0.1),
    )
    .map((r) => ({
      tournamentName: r.tournamentName,
      year: r.year,
      rank: r.speakerRankOpen!,
      totalTeams: r.totalTeams!,
    }))
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5);

  const bestSpeakerRank = speakerRows.reduce<CvHighlights['bestSpeakerRank']>((best, r) => {
    if (r.speakerRankOpen == null) return best;
    if (!best || r.speakerRankOpen < best.rank) {
      return { tournamentName: r.tournamentName, year: r.year, rank: r.speakerRankOpen };
    }
    return best;
  }, null);

  const bestSpeakerAverage = speakerRows.reduce<CvHighlights['bestSpeakerAverage']>(
    (best, r) => {
      if (!r.speakerAvgScore) return best;
      const score = Number(r.speakerAvgScore);
      if (!Number.isFinite(score)) return best;
      if (!best || score > best.score) {
        return { tournamentName: r.tournamentName, year: r.year, score };
      }
      return best;
    },
    null,
  );

  const outroundsChaired = judgeRows.filter((r) => !!r.lastOutroundChaired).length;

  const majorEvents = [...speakerRows, ...judgeRows]
    .filter((r) => MAJOR_PATTERN.test(r.tournamentName))
    .map((r) => ({ tournamentName: r.tournamentName, year: r.year }))
    // Dedup by name+year so a user with both a speaker and judge row at the
    // same major doesn't double-count.
    .filter((m, i, all) => i === all.findIndex((x) => x.tournamentName === m.tournamentName && x.year === m.year));

  const allYears = [...speakerRows, ...judgeRows]
    .map((r) => r.year)
    .filter((y): y is number => y != null);
  const activeYears = allYears.length
    ? { from: Math.min(...allYears), to: Math.max(...allYears) }
    : null;

  const highlights: CvHighlights = {
    championships,
    topBreaks,
    bestSpeakerRank,
    bestSpeakerAverage,
    outroundsChaired,
    majorEvents,
    activeYears,
  };

  return {
    user: user ?? null,
    myDisplayName,
    speakerRows,
    judgeRows,
    unmatchedTournaments,
    summary: { totalTournaments, breaks, totalRoundsChaired },
    highlights,
  };
}
