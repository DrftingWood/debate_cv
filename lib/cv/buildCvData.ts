import { prisma } from '@/lib/db';
import { normalizePersonName } from '@/lib/calicotab/fingerprint';
import { classifyRoundLabel, deepestOutroundAcrossRoles, outroundRank } from '@/lib/calicotab/judgeStats';
import { mergeSpeakerCvSignals } from '@/lib/cv/speakerSignals';
import { computeSpeakerAvg } from '@/lib/cv/computeSpeakerAvg';
import { buildTeamRankLookup, teamResultKey } from '@/lib/cv/teamRanks';
import { isJudgeParticipant } from '@/lib/cv/roleClassification';
import { pickPrelimRoundCount } from '@/lib/calicotab/prelimRoundCount';
import {
  deepestOutroundsByCategory,
  isEudcTournament,
  type CategoryOutround,
} from '@/lib/calicotab/breakCategoryResolve';

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

/**
 * The user's team's per-round result, joined from TeamResult rows for
 * their primary team. `position` (OG/OO/CG/CO on BP layouts) is only
 * present on tournaments ingested since the parser started persisting it
 * (PARSER_VERSION 20260611.0) — older rows carry null until re-ingest.
 * Feeds the by-position slice on /cv/stats.
 */
export type CvTeamRoundResult = {
  roundNumber: number;
  position: string | null;
  /** Round outcome when the results page recorded one; null otherwise. */
  won: boolean | null;
  /** Team points for the round (BP: 0–3); null when not parsed. */
  points: number | null;
};

export type CvSpeakerRow = {
  tournamentId: bigint;
  tournamentName: string;
  year: number | null;
  format: string | null;
  /** Admin-approved region tag (lib/tags/vocabulary.ts); null until tagged. */
  region: string | null;
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
  /**
   * EUDC-only: when a team breaks in both Open and ESL the deepest
   * outround is different per category (e.g. lost Open Octos but
   * reached ESL Grand Final). Populated only for EUDC tournaments and
   * only when the team appeared in outrounds across more than one
   * category — null otherwise. Sorted by category priority (Open
   * first). Display sites should prefer this over `eliminationReached`
   * when present.
   */
  eliminationReachedByCategory: CategoryOutround[] | null;
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
  /** The user's team's per-round results (position / outcome / points). */
  teamRoundResults: CvTeamRoundResult[];
};

export type CvJudgeRow = {
  tournamentId: bigint;
  tournamentName: string;
  year: number | null;
  format: string | null;
  /** Admin-approved region tag (lib/tags/vocabulary.ts); null until tagged. */
  region: string | null;
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
  /**
   * Tournaments where the user served as adj core / Tab Director / Chief
   * Adjudicator / Deputy CA — distinct from regular judging stints. Counted
   * separately so the CV can surface "5× adj core" as its own credential
   * rather than hiding the role inside a generic judge count.
   */
  adjCoreCount: number;
  /** Detected major-circuit events the user has attended (WUDC / EUDC / Australs / Worlds). */
  majorEvents: { tournamentName: string; year: number | null }[];
  /** Earliest and latest year with at least one row. */
  activeYears: { from: number; to: number } | null;
};

/**
 * Motion rows (text + approved community tags) for tournaments on this CV.
 *
 * Carried on CvData rather than joined into speaker rows because the join
 * key is (tournamentId, roundNumber) and several consumers want it at
 * different granularities: the analytics motion slices aggregate by tag,
 * /cv/motions lists the text per round, and the CV row detail shows the
 * motion next to the score for that round. Text is included now that the
 * UI renders it — the tags-only projection was a pre-rebuild economy.
 */
export type CvTaggedMotion = {
  tournamentId: bigint;
  roundNumber: number | null;
  /** Raw label as released ("Round 3", "Semifinals"). */
  roundLabel: string;
  /** Document order on the motions page; tiebreaker within a round. */
  seq: number;
  text: string;
  infoSlide: string | null;
  motionType: string | null;
  topic: string | null;
};

/**
 * Per-tournament summary of the FIELD the user competed against, derived
 * from every speaker the tab published — not just the user's own row.
 *
 * This is the single most valuable thing the ingest pipeline already stores
 * and never surfaced: a 78.4 average means nothing on its own, but "78.4
 * against a field averaging 75.1, 12th of 214 speakers" is a real
 * competitive statement. Computed here (next to the DB) and consumed as
 * plain numbers by the pure stats layer.
 *
 * Score-unit figures are derived by dividing the field's score TOTALS by
 * the tournament's prelim round count. That is exact when every speaker
 * spoke every prelim and approximate otherwise (swing/absent speakers pull
 * their own totals down); the rank-based percentile below carries no such
 * assumption, so prefer it when both are available.
 */
export type CvFieldStat = {
  tournamentId: bigint;
  /** Speakers on the tab carrying a parsed score total. */
  speakerCount: number;
  /** Mean of the field's per-speaker average, in score units. */
  fieldMeanAvg: number | null;
  /** Population standard deviation of the same, in score units. */
  fieldStdevAvg: number | null;
  /** Median and 90th-percentile per-speaker average, in score units. */
  fieldMedianAvg: number | null;
  fieldP90Avg: number | null;
  /**
   * How many speakers finished strictly above the user on total score.
   * `betterThanUser + 1` is the user's rank on this measure, computed from
   * the tab's own numbers rather than trusting a Rank column that some
   * installs never publish.
   */
  betterThanUser: number | null;
};

export type CvData = {
  user: { name: string | null; email: string | null; image: string | null } | null;
  myDisplayName: string;
  speakerRows: CvSpeakerRow[];
  judgeRows: CvJudgeRow[];
  taggedMotions: CvTaggedMotion[];
  fieldStats: CvFieldStat[];
  unmatchedTournaments: CvUnmatchedTournament[];
  summary: {
    totalTournaments: number;
    breaks: number;
    totalRoundsChaired: number;
  };
  highlights: CvHighlights;
};

export type BuildCvDataOptions = {
  /**
   * Compute the per-tournament field summary (see CvFieldStat). Costs one
   * extra query that returns EVERY speaker published on every tournament
   * on the CV — low tens of thousands of rows for a heavy user. Callers
   * that don't render placement figures should pass false; the public
   * /u/<slug> page does, since it shows the user's own averages only.
   * Defaults to true so a new consumer gets the richer payload by default.
   */
  includeFieldStats?: boolean;
};

export async function buildCvData(
  userId: string,
  options: BuildCvDataOptions = {},
): Promise<CvData> {
  const includeFieldStats = options.includeFieldStats ?? true;
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
        // Pulls every column including speakerRankOpenDerived (the persisted
        // ROW_NUMBER fallback written at ingest time — see sub-project 7).
        // If this ever switches to `select`, speakerRankOpenDerived must be
        // explicitly listed or the rank read at L560 silently degrades.
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
  // Two sources, in priority order:
  //   1. Tournament.prelimRoundCount — set at ingest time from the
  //      authoritative landing-nav round list (counts only prelim, non-outround
  //      results URLs). Most reliable.
  //   2. MAX(TeamResult.roundNumber) for prelim rounds — derived from how many
  //      rounds we successfully parsed per-team data for. Fallback for older
  //      tournaments ingested before #1 was stored, or where the team-tab
  //      had no per-round breakdown either.
  // Resolve the prelim-round count per tournament from the two known
  // sources (stored Tournament.prelimRoundCount first, MAX(TeamResult
  // .roundNumber) fallback). The rule itself lives in pickPrelimRoundCount
  // so the read path and any future call site share one definition.
  // Run the two queries in parallel — neither depends on the other.
  const prelimRoundCountByTournament = new Map<bigint, number>();
  if (tournamentIds.length > 0) {
    const [tournamentRows, maxRoundRows] = await Promise.all([
      prisma.tournament.findMany({
        where: { id: { in: tournamentIds } },
        select: { id: true, prelimRoundCount: true },
      }),
      prisma.teamResult.groupBy({
        by: ['tournamentId'],
        where: { tournamentId: { in: tournamentIds }, roundNumber: { gt: 0 } },
        _max: { roundNumber: true },
      }),
    ]);
    const maxByTournament = new Map<bigint, number | null>();
    for (const r of maxRoundRows) {
      maxByTournament.set(r.tournamentId, r._max.roundNumber);
    }
    for (const t of tournamentRows) {
      const picked = pickPrelimRoundCount({
        stored: t.prelimRoundCount,
        maxTeamRoundNumber: maxByTournament.get(t.id) ?? null,
      });
      if (picked != null) prelimRoundCountByTournament.set(t.id, picked);
    }
  }

  const [teammateRows, teamResultRows, teamRoundRows, judgeAssignmentRows, adjudicatorBreakRows] = await Promise.all([
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
    // Per-round rows for the user's own teams only — position/outcome/points
    // feed the by-position analytics slice. Scoped to myTeamPairs rather
    // than the whole tournament so a WUDC-sized ingest doesn't drag
    // hundreds of teams × 9 rounds through the CV build.
    myTeamPairs.length
      ? prisma.teamResult.findMany({
          where: {
            OR: myTeamPairs.map((p) => ({
              tournamentId: p.tournamentId,
              teamName: p.teamName,
            })),
            roundNumber: { gt: 0 },
          },
          select: {
            tournamentId: true,
            teamName: true,
            roundNumber: true,
            position: true,
            wins: true,
            points: true,
          },
        })
      : Promise.resolve([] as Array<{
          tournamentId: bigint;
          teamName: string | null;
          roundNumber: number | null;
          position: string | null;
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

  // EUDC-only: collect every outround stage label per (tournament, team) so
  // we can derive deepest-per-category for the EUDC dual-break case (a
  // team that breaks in Open AND ESL has different deepest outrounds in
  // each bracket — "Octofinals" in Open, "ESL Grand Final" in ESL — and
  // we want to surface both on the CV instead of collapsing to one).
  // Pulls all team EliminationResult rows regardless of result so a row
  // missing its win/loss indicator still contributes the stage. Skipped
  // entirely on non-EUDC tournaments to keep the query bounded.
  const eudcTournamentIds = tournamentIds.filter((tid) => {
    const t = tournamentById.get(tid);
    return t ? isEudcTournament(t.name) : false;
  });
  const teamOutroundStagesByKey = new Map<string, string[]>();
  if (eudcTournamentIds.length > 0) {
    const rows = await prisma.eliminationResult.findMany({
      where: { tournamentId: { in: eudcTournamentIds }, entityType: 'team' },
      select: { tournamentId: true, entityName: true, stage: true },
    });
    for (const r of rows) {
      const key = `${r.tournamentId}:${r.entityName}`;
      const list = teamOutroundStagesByKey.get(key) ?? [];
      list.push(r.stage);
      teamOutroundStagesByKey.set(key, list);
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

  const teamRoundsByKey = new Map<string, CvTeamRoundResult[]>();
  for (const tr of teamRoundRows) {
    if (!tr.teamName || tr.roundNumber == null) continue;
    const key = teamResultKey(tr.tournamentId, tr.teamName);
    if (!myTeamPairKeys.has(key)) continue;
    const list = teamRoundsByKey.get(key) ?? [];
    list.push({
      roundNumber: tr.roundNumber,
      position: tr.position,
      won: tr.wins == null ? null : tr.wins > 0,
      points: tr.points == null ? null : Number(tr.points),
    });
    teamRoundsByKey.set(key, list);
  }
  for (const list of teamRoundsByKey.values()) {
    list.sort((a, b) => a.roundNumber - b.roundNumber);
  }

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
    const speakerAvgScore = computeSpeakerAvg({
      averageCellScore: averageScoreValue,
      numericScores,
      speakerScoreTotal: total,
      prelimRoundCount: prelimRoundCountByTournament.get(tid) ?? null,
    });

    // Champion check: did the user's team win the deepest outround they
    // reached, AND was that outround the tournament's final? Anything
    // shallower (e.g. winning Semis but losing GF) doesn't count as winning
    // the tournament — Semis-win is implied by having reached GF at all.
    // Reuse outroundRank's stage classification so "Quarterfinal" (which
    // contains the substring "final") is correctly excluded. Anchoring
    // against outroundRank('Final') keeps both "Final" (= finalRank) and
    // "Grand Final" (> finalRank) eligible — a tournament's last round
    // can be labeled either way depending on the Tabbycat install.
    let wonTournament: boolean | null = null;
    if (p.teamName && speakerSignals.eliminationReached) {
      const deepest = speakerSignals.eliminationReached;
      const stageRank = outroundRank({ roundLabel: deepest, roundNumber: null, isOutround: true });
      const finalRank = outroundRank({ roundLabel: 'Final', roundNumber: null, isOutround: true });
      const isFinalStage = stageRank >= finalRank;
      if (isFinalStage) {
        const result = teamOutroundResultByKey.get(`${tid}:${p.teamName}:${deepest}`);
        if (result === 'won') wonTournament = true;
        else if (result === 'lost') wonTournament = false;
      }
    }

    // EUDC dual-break breakdown. Only set when more than one category
    // has an outround appearance — a team that only debated in Open
    // outrounds gets the existing single-stage `eliminationReached` and
    // we leave this null to avoid noise.
    let eliminationReachedByCategory: CategoryOutround[] | null = null;
    if (p.teamName && isEudcTournament(t.name)) {
      const stages = teamOutroundStagesByKey.get(`${tid}:${p.teamName}`) ?? [];
      const byCategory = deepestOutroundsByCategory(stages, (stage) =>
        outroundRank({ roundLabel: stage, roundNumber: null, isOutround: true }),
      );
      if (byCategory.length > 1) eliminationReachedByCategory = byCategory;
    }

    speakerRows.push({
      tournamentId: tid,
      tournamentName: t.name,
      year: t.year,
      format: t.format,
      region: t.region,
      totalTeams: t.totalTeams,
      sourceUrl: t.sourceUrlRaw,
      myName: myNameByTournament.get(tid) ?? myDisplayName,
      teammates: teamKey ? (teammatesByKey.get(teamKey) ?? []) : [],
      teamName: p.teamName,
      teamRank: teamKey ? (teamRankByKey.get(teamKey) ?? null) : null,
      teamPoints: tr?.points ?? null,
      teamWins: tr?.wins ?? null,
      speakerAvgScore,
      prelimsSpoken,
      // Open rank: prefer the parser's value; fall back to the ingest-time
      // ROW_NUMBER(...) over speakerScoreTotal persisted at ingest as
      // speakerRankOpenDerived. Covers BP/AP tabs whose rank header doesn't
      // match the canonical "Rank/#" patterns and whose cell parses to null.
      speakerRankOpen: p.speakerRankOpen ?? p.speakerRankOpenDerived ?? null,
      speakerRankEsl: p.speakerRankEsl,
      speakerRankEfl: p.speakerRankEfl,
      teamBreakRank: speakerSignals.teamBreakRank,
      eliminationReached: speakerSignals.eliminationReached,
      eliminationReachedByCategory,
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
      teamRoundResults: teamKey ? (teamRoundsByKey.get(teamKey) ?? []) : [],
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
    if (!isJudgeParticipant(p)) continue;
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
      region: t.region,
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

  // Motions for the analytics join, /cv/motions, and the per-round detail
  // on the CV. Fetched late (not in the main Promise.all) because it
  // depends only on tournamentIds and the result is small — a handful of
  // motions per tournament.
  const taggedMotions: CvTaggedMotion[] = tournamentIds.length
    ? await prisma.motion.findMany({
        where: { tournamentId: { in: tournamentIds } },
        select: {
          tournamentId: true,
          roundNumber: true,
          roundLabel: true,
          seq: true,
          text: true,
          infoSlide: true,
          motionType: true,
          topic: true,
        },
        orderBy: [{ tournamentId: 'asc' }, { seq: 'asc' }],
      })
    : [];

  // ── Field context ────────────────────────────────────────────────────
  // Every speaker the tab published for each of the user's tournaments,
  // projected to two columns. Bounded by construction: a large tournament
  // publishes ~800 speakers, so even a heavy CV pulls low tens of
  // thousands of (bigint, decimal) pairs — cheaper than the per-round
  // score rows this deliberately does NOT fetch (800 speakers × 9 rounds
  // per tournament would be an order of magnitude more for a round-level
  // percentile nobody has asked for yet).
  const fieldStats: CvFieldStat[] = [];
  if (includeFieldStats && tournamentIds.length > 0) {
    const fieldRows = await prisma.tournamentParticipant.findMany({
      where: {
        tournamentId: { in: tournamentIds },
        speakerScoreTotal: { not: null },
        roles: { some: { role: 'speaker' } },
      },
      select: { tournamentId: true, speakerScoreTotal: true },
    });

    const totalsByTournament = new Map<bigint, number[]>();
    for (const row of fieldRows) {
      if (row.speakerScoreTotal == null) continue;
      const value = Number(row.speakerScoreTotal);
      if (!Number.isFinite(value)) continue;
      const list = totalsByTournament.get(row.tournamentId) ?? [];
      list.push(value);
      totalsByTournament.set(row.tournamentId, list);
    }

    // The user's own total per tournament, taken from the same richest
    // participation the speaker rows were built from, so the "better than
    // you" count compares like with like.
    const myTotalByTournament = new Map<bigint, number>();
    for (const [tid, p] of speakerByTournament.entries()) {
      if (p.speakerScoreTotal == null) continue;
      const value = Number(p.speakerScoreTotal);
      if (Number.isFinite(value)) myTotalByTournament.set(tid, value);
    }

    for (const [tournamentId, totals] of totalsByTournament.entries()) {
      const sorted = [...totals].sort((a, b) => a - b);
      const divisor = prelimRoundCountByTournament.get(tournamentId) ?? null;
      const toAvg = (total: number | null): number | null =>
        total == null || divisor == null || divisor <= 0 ? null : total / divisor;

      const mean = sorted.reduce((s, v) => s + v, 0) / sorted.length;
      const variance =
        sorted.reduce((s, v) => s + (v - mean) * (v - mean), 0) / sorted.length;
      const quantile = (q: number): number => {
        if (sorted.length === 1) return sorted[0];
        const pos = (sorted.length - 1) * q;
        const lo = Math.floor(pos);
        const hi = Math.ceil(pos);
        return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
      };

      const myTotal = myTotalByTournament.get(tournamentId) ?? null;
      fieldStats.push({
        tournamentId,
        speakerCount: sorted.length,
        fieldMeanAvg: toAvg(mean),
        // stdev scales with the same divisor as the mean, so dividing the
        // total-space stdev converts it to score units directly.
        fieldStdevAvg: divisor && divisor > 0 ? Math.sqrt(variance) / divisor : null,
        fieldMedianAvg: toAvg(quantile(0.5)),
        fieldP90Avg: toAvg(quantile(0.9)),
        betterThanUser:
          myTotal == null ? null : sorted.filter((v) => v > myTotal).length,
      });
    }
  }

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
  const adjCoreCount = judgeRows.filter((r) => r.judgeTypeTag === 'core').length;

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
    adjCoreCount,
    majorEvents,
    activeYears,
  };

  return {
    user: user ?? null,
    myDisplayName,
    speakerRows,
    judgeRows,
    taggedMotions,
    fieldStats,
    unmatchedTournaments,
    summary: { totalTournaments, breaks, totalRoundsChaired },
    highlights,
  };
}
