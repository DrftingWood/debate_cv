import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { publicTournamentUrl } from '@/lib/cv/publicTournamentUrl';
import { normalizePersonName } from '@/lib/calicotab/fingerprint';
import {
  classifyRoundLabel,
  deepestOutroundAcrossRoles,
  outroundRank,
} from '@/lib/calicotab/judgeStats';
import { mergeSpeakerCvSignals } from '@/lib/cv/speakerSignals';
import { computeSpeakerAvg } from '@/lib/cv/computeSpeakerAvg';
import { buildTeamRankLookup, teamResultKey } from '@/lib/cv/teamRanks';
import { isMajor } from '@/lib/cv/majors';
import { summarizeBreaks } from '@/lib/cv/headerMetrics';
import {
  bestSpeakerRankHighlight,
  championshipHighlights,
  placementHighlights,
} from '@/lib/cv/teamPlacement';
import { isJudgeParticipant } from '@/lib/cv/roleClassification';
import { pickPrelimRoundCount, prelimMaxFromRoundCounts } from '@/lib/calicotab/prelimRoundCount';
import { displayNameFor } from '@/lib/privacy/suppression';
import { deriveOpenBreak, type CvOpenBreak, type StandingLike } from '@/lib/cv/breakMargin';
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

export type CvTeammate = {
  /**
   * Opaque per-person key. Display names are masked (every withdrawn
   * debater reads the same) and can collide between real people, so
   * anything that groups or filters by teammate keys on this, not the name.
   */
  key: string;
  name: string;
  speakerScoreTotal: number | null;
  roundScores: CvSpeakerRoundScore[];
};

export type CvSpeakerRow = {
  tournamentId: bigint;
  tournamentName: string;
  year: number | null;
  /**
   * Earliest date a private link for this tournament was emailed (YYYY-MM-DD),
   * or null. The only within-season date on record: tabs publish a year, not
   * dates, and the link usually arrives days before the tournament. Used to
   * order a season; never shown as the tournament's date.
   */
  emailDate: string | null;
  format: string | null;
  /** Admin-approved region tag (lib/tags/vocabulary.ts); null until tagged. */
  region: string | null;
  totalTeams: number | null;
  sourceUrl: string;
  myName: string;
  teammates: string[];
  /**
   * The same teammates with their own tab figures: total and per-round
   * speeches. Their average against the user's decides whether a pairing was
   * pro-am, and round-by-round scores feed the carry index. Names are masked
   * exactly as `teammates` is; a withdrawn teammate's figures stay, because
   * they are facts about the user's own team, but their name never does.
   */
  teammateDetails: CvTeammate[];
  teamName: string | null;
  teamRank: number | null;
  /** Another team on the same tab holds this rank, so it reads "5=" (display only; I17). */
  teamRankTied?: boolean;
  teamPoints: string | null;
  teamWins: number | null;
  /**
   * Rooms topped and rooms placed second. BP ranks on points and breaks
   * ties on these, so two teams level on points are not level on the tab —
   * this is what separates them. Null on the two-team formats, which
   * publish wins instead.
   */
  teamFirsts: number | null;
  teamSeconds: number | null;
  speakerAvgScore: string | null;
  prelimsSpoken: number;
  /**
   * The tournament's prelim count. `teamRoundResults` carries every round the
   * team debated, outrounds included, so this is what separates the two.
   */
  prelimRoundCount: number | null;
  speakerRankOpen: number | null;
  /** Speakers on the tab with a score total (the field the rank is against); absent when the field was not loaded. */
  speakerFieldSize?: number | null;
  /** Another speaker has the same total, so the rank reads "7=". False when the field was not loaded. */
  speakerRankTied?: boolean;
  speakerRankEsl: number | null;
  speakerRankEfl: number | null;
  /**
   * Break categories the tournament declared for this speaker. Tabbycat
   * 2.11 publishes these instead of the ESL/EFL RANK columns above, so on
   * a modern install those ranks are null and this is the only statement
   * of which brackets the speaker was eligible for.
   */
  speakerCategories: string[];
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
   * The tournament's Open break line — the lowest breaking team's points and
   * wins — and whether the user's team was on it. Null when no Open break tab
   * is stored. Feeds the break-margin view; see lib/cv/breakMargin.ts for why
   * the line is the lowest breaker and not the best non-breaker.
   */
  openBreak: CvOpenBreak | null;
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
  /**
   * The prelim round numbers the user sat on a panel for, from their own
   * assignments. The Motions page lists only these rounds for a tournament
   * the user judged but did not speak at; `inroundsJudged` is just a count.
   */
  judgedRoundNumbers: number[];
  /** Outround stage labels the user judged ("Quarterfinals", "ESL Semifinals"). */
  judgedOutroundStages: string[];
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
  championships: {
    tournamentName: string;
    year: number | null;
    /** Set for a category title (ESL, EFL, Novice, Silver …); absent for the Open title. */
    category?: string;
  }[];
  /**
   * Breaks ranked by strength: furthest outround reached first, then a won
   * final, then break seed, then team-tab placement (compareBreakStrength in
   * lib/cv/teamPlacement.ts). Never by speaker rank — break depth is a team
   * fact. `stage` is null for a break whose outround draw was never published.
   */
  deepestBreaks: {
    tournamentName: string;
    year: number | null;
    stage: string | null;
    won: boolean;
    breakRank: number | null;
  }[];
  /**
   * Tournaments where the user was a Top 10 speaker: Open speaker-tab rank
   * <= TOP_SPEAKER_RANK (10), best rank first. An absolute rank, not a
   * percentile (owner decision, assumptions C3/Q5) — it replaces the earlier
   * "top 10% of the team tab" rule and its ceil rounding. `totalTeams` is the
   * field size when known, for context only.
   */
  topSpeakerFinishes: {
    tournamentName: string;
    year: number | null;
    rank: number;
    totalTeams: number | null;
  }[];
  /** Best team-tab placement as a share of the field (ties: the bigger field). */
  bestTeamFinish: {
    tournamentName: string;
    year: number | null;
    rank: number;
    totalTeams: number;
    topPercent: number;
    /** The team rank is shared (reads "5th="). */
    tied: boolean;
  } | null;
  /**
   * Single best Open SPEAKER-tab rank across all tournaments. An individual
   * statistic: every surface labels it as the speaker tab, and nothing uses
   * it as the measure of how high the user placed.
   */
  bestSpeakerRank: {
    tournamentName: string;
    year: number | null;
    rank: number;
    /** Speakers on that tab; null when unknown. */
    totalSpeakers: number | null;
    /** rank / totalSpeakers as a percentage ("top N%"); null with the field. */
    topPercent: number | null;
    /** The rank is shared with another speaker (reads "5th="). */
    tied: boolean;
  } | null;
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
  /** Detected major-circuit events the user has attended (the list in lib/cv/majors.ts). */
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
 * One knockout round the user's team debated, with its result: 'won' means
 * the team advanced (or won the final), 'lost' that it went out there.
 *
 * Outround motions carry no round number, so they cannot join to round data
 * the way prelim motions do; this is what they join to instead, by stage and
 * break category (lib/cv/motionEntries.ts#sameKnockoutStage). `stage` is the
 * label exactly as stored on EliminationResult — the same string
 * `wonTournament` keys on. Outround speaker scores are not published, so a
 * result is all there is.
 */
export type CvTeamOutroundResult = {
  tournamentId: bigint;
  stage: string;
  won: boolean;
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
  /**
   * Prelim rounds the user was actually scored in, against the
   * tournament's prelim round count.
   *
   * These differ when the user swung, arrived late, or the tab simply
   * didn't publish one of their cells — and when they differ, the
   * placement above is NOT comparable with the per-round figures beside
   * it. Placement ranks on TOTAL score, so a speaker who missed a round
   * sinks to the bottom of the tab while their per-round average stays
   * well above the field mean. Displaying both without saying so produced
   * a genuinely contradictory row: "+3.4 above the field, placed 89th of
   * 89". Consumers use this to mark the row and to exclude it from career
   * aggregates. Null when the round count is unknown.
   */
  userScoredRounds: number | null;
  prelimRoundCount: number | null;
};

export type CvData = {
  user: { name: string | null; email: string | null; image: string | null } | null;
  myDisplayName: string;
  speakerRows: CvSpeakerRow[];
  judgeRows: CvJudgeRow[];
  taggedMotions: CvTaggedMotion[];
  /** The user's own team's outround results, for the knockout motion join. */
  teamOutroundResults: CvTeamOutroundResult[];
  fieldStats: CvFieldStat[];
  unmatchedTournaments: CvUnmatchedTournament[];
  summary: {
    totalTournaments: number;
    /** Tournaments the user broke at as a speaker (team break). Judged outrounds are not counted here. */
    speakingBreaks: number;
    /** Tournaments the user broke at as a judge (judged an outround or on the adjudicator break). */
    judgingBreaks: number;
    /** Distinct tournaments spoken at: the speaking break rate's denominator. */
    tournamentsSpoken: number;
    /** Distinct tournaments judged at: the judging break rate's denominator. */
    tournamentsJudged: number;
    totalRoundsChaired: number;
  };
  highlights: CvHighlights;
  /**
   * When the newest tournament on this record finished ingesting. The "as of"
   * date the CV headers show; the render date said "compiled today" on every
   * visit, which is not a fact about the data (CV-10).
   */
  lastIngestedAt?: Date | null;
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

  const claimedNormalizedNames = new Set(claimedPersons.map((p) => p.normalizedName));

  // The season-ordering date comes from the user's OWN private URL only. A
  // mailbox also holds links registered to other people — a teammate's
  // forwarded private URL, a convenor's broadcast — and those emails can
  // land weeks before or after the user's own, so taking the earliest across
  // every URL let someone else's email decide where this tournament sits in
  // the season. A URL is the user's own when its registration person is one
  // they claimed, or its registration name normalises to a claimed alias (the
  // alias test myNameByTournament applies below). A URL whose landing
  // never named anyone (registrationName null or '', no person) carries no
  // evidence either way; it was still found in the user's own mail, so it
  // counts — dropping it would blank the date for every tournament whose
  // private-URL page doesn't print a name.
  const isSomeoneElsesUrl = (u: (typeof urls)[number]): boolean => {
    if (u.registrationPersonId != null && claimedPersonIds.has(u.registrationPersonId))
      return false;
    const reg = (u.registrationName ?? '').trim();
    if (reg && claimedNormalizedNames.has(normalizePersonName(reg))) return false;
    return u.registrationPersonId != null || !!reg;
  };
  const emailDateByTournament = new Map<bigint, string>();
  for (const u of urls) {
    if (!u.tournamentId || !u.messageDate) continue;
    if (isSomeoneElsesUrl(u)) continue;
    const day = u.messageDate.toISOString().slice(0, 10);
    const prev = emailDateByTournament.get(u.tournamentId);
    if (!prev || day < prev) emailDateByTournament.set(u.tournamentId, day);
  }

  // Per-tournament registration name from the URL the user actually uploaded,
  // gated by whether that name is in their claimed-aliases set. Different
  // tournaments often spell the same person differently — show the spelling
  // that was on this tournament's private URL rather than a single canonical
  // name plastered across every row. Sort by URL so the picked spelling is
  // deterministic across page loads.
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
  // Three sources, in priority order — the rule itself lives in
  // pickPrelimRoundCount so the read path and any future call site share
  // one definition:
  //   1. Tournament.prelimRoundCount — set at ingest time from the
  //      authoritative landing-nav round list (counts only prelim,
  //      non-outround results URLs). Most reliable.
  //   2. The last round most of the field has a TeamResult for
  //      (prelimMaxFromRoundCounts — outrounds seat only the break). Fallback for older
  //      tournaments ingested before #1 was stored, or where the team tab
  //      had no per-round breakdown.
  //   3. MAX(SpeakerRoundScore.roundNumber) across every participant —
  //      last resort for tournaments that published a speaker tab with
  //      per-round columns but neither of the above. Without it, the field
  //      summary loses its divisor and every score-unit figure blanks out
  //      while the placement still renders, which reads as a bug.
  //
  // Source 3 needs a join (SpeakerRoundScore has no tournamentId), so it is
  // raw SQL. It is an aggregate: one row per tournament, no score rows
  // cross the wire. All three run in parallel — none depends on another.
  const prelimRoundCountByTournament = new Map<bigint, number>();
  if (tournamentIds.length > 0) {
    const [tournamentRows, maxRoundRows, maxSpeakerRoundRows] = await Promise.all([
      prisma.tournament.findMany({
        where: { id: { in: tournamentIds } },
        select: { id: true, prelimRoundCount: true },
      }),
      prisma.teamResult.groupBy({
        by: ['tournamentId', 'roundNumber'],
        where: { tournamentId: { in: tournamentIds }, roundNumber: { gt: 0 } },
        _count: { _all: true },
      }),
      prisma.$queryRaw<{ tournamentId: bigint; maxRound: number | null }[]>`
        SELECT tp."tournamentId" AS "tournamentId",
               MAX(srs."roundNumber")::int AS "maxRound"
        FROM "SpeakerRoundScore" srs
        JOIN "TournamentParticipant" tp ON tp."id" = srs."tournamentParticipantId"
        WHERE tp."tournamentId" IN (${Prisma.join(tournamentIds)})
          AND srs."roundNumber" > 0
          AND srs."positionLabel" <> 'average'
        GROUP BY tp."tournamentId"
      `,
    ]);
    const maxSpeakerRoundByTournament = new Map<bigint, number | null>();
    for (const r of maxSpeakerRoundRows) {
      maxSpeakerRoundByTournament.set(r.tournamentId, r.maxRound);
    }
    const roundCountsByTournament = new Map<
      bigint,
      Array<{ roundNumber: number; teams: number }>
    >();
    for (const r of maxRoundRows) {
      if (r.roundNumber == null) continue;
      const list = roundCountsByTournament.get(r.tournamentId) ?? [];
      list.push({ roundNumber: r.roundNumber, teams: r._count._all });
      roundCountsByTournament.set(r.tournamentId, list);
    }
    const maxByTournament = new Map<bigint, number | null>();
    for (const [tid, counts] of roundCountsByTournament) {
      maxByTournament.set(tid, prelimMaxFromRoundCounts(counts));
    }
    for (const t of tournamentRows) {
      const picked = pickPrelimRoundCount({
        stored: t.prelimRoundCount,
        maxTeamRoundNumber: maxByTournament.get(t.id) ?? null,
        maxSpeakerRoundNumber: maxSpeakerRoundByTournament.get(t.id) ?? null,
      });
      if (picked != null) prelimRoundCountByTournament.set(t.id, picked);
    }
  }

  const [teammateRows, teamResultRows, teamRoundRows, judgeAssignmentRows, adjudicatorBreakRows] =
    await Promise.all([
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
              person: { select: { displayName: true, suppressedAt: true } },
              speakerScoreTotal: true,
              speakerRoundScores: {
                select: { roundNumber: true, positionLabel: true, score: true },
              },
            },
          })
        : Promise.resolve(
            [] as Array<{
              tournamentId: bigint;
              teamName: string | null;
              personId: bigint;
              person: { displayName: string; suppressedAt: Date | null };
              speakerScoreTotal: { toString(): string } | null;
              speakerRoundScores: Array<{
                roundNumber: number;
                positionLabel: string | null;
                score: { toString(): string } | null;
              }>;
            }>,
          ),
      tournamentIds.length
        ? prisma.teamResult.findMany({
            where: { tournamentId: { in: tournamentIds }, roundNumber: 0 },
            select: {
              tournamentId: true,
              teamName: true,
              rank: true,
              wins: true,
              points: true,
              firsts: true,
              seconds: true,
            },
          })
        : Promise.resolve(
            [] as Array<{
              tournamentId: bigint;
              teamName: string | null;
              rank: number | null;
              wins: number | null;
              points: { toString(): string } | null;
              firsts: number | null;
              seconds: number | null;
            }>,
          ),
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
        : Promise.resolve(
            [] as Array<{
              tournamentId: bigint;
              teamName: string | null;
              roundNumber: number | null;
              position: string | null;
              wins: number | null;
              points: { toString(): string } | null;
            }>,
          ),
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
        : Promise.resolve(
            [] as Array<{
              tournamentId: bigint;
              personId: bigint;
              stage: string | null;
              panelRole: string | null;
              roundNumber: number | null;
            }>,
          ),
      tournamentIds.length
        ? prisma.eliminationResult.findMany({
            where: { tournamentId: { in: tournamentIds }, entityType: 'adjudicator' },
            select: { tournamentId: true, entityName: true, stage: true },
          })
        : Promise.resolve(
            [] as Array<{
              tournamentId: bigint;
              entityName: string;
              stage: string;
            }>,
          ),
    ]);

  // ── Everything else this function needs, in one round trip ───────────
  //
  // These five reads are mutually independent and depend only on values
  // already resolved above (tournamentIds, userId, tournamentById). They
  // used to be awaited one after another, spread across the body of the
  // function next to the code that consumed each one — five sequential
  // round trips on top of the three batched ones. That reads nicely and
  // costs real latency: locally it is a couple of milliseconds, but the
  // production database is a pooled Neon instance where every round trip
  // is a network hop, and /cv, /cv/stats and the export all pay it.
  //
  // The QUERIES are batched here; the map-building that consumes each one
  // stays where it was, next to the logic that explains it.
  const eudcTournamentIds = tournamentIds.filter((tid) => {
    const t = tournamentById.get(tid);
    return t ? isEudcTournament(t.name) : false;
  });

  const [teamOutroundRows, eudcOutroundRows, openReportRows, motionRows, fieldRows, openBreakRows] =
    await Promise.all([
      // Outround team win/loss results. Feed `wonTournament` per speaker row
      // — did the user's team win the deepest outround they reached, and was
      // that outround the Grand Final.
      tournamentIds.length
        ? prisma.eliminationResult.findMany({
            where: {
              tournamentId: { in: tournamentIds },
              entityType: 'team',
              result: { in: ['won', 'lost'] },
            },
            select: { tournamentId: true, entityName: true, stage: true, result: true },
          })
        : Promise.resolve(
            [] as Array<{
              tournamentId: bigint;
              entityName: string;
              stage: string;
              result: string | null;
            }>,
          ),

      // EUDC-only: every outround stage label per (tournament, team), so we
      // can derive deepest-per-category for the dual-break case (a team that
      // breaks in Open AND ESL has different deepest outrounds in each
      // bracket — "Octofinals" in Open, "ESL Grand Final" in ESL — and the CV
      // shows both instead of collapsing to one). Pulls all team rows
      // regardless of result so a row missing its win/loss indicator still
      // contributes its stage. Skipped entirely on non-EUDC tournaments.
      eudcTournamentIds.length
        ? prisma.eliminationResult.findMany({
            where: { tournamentId: { in: eudcTournamentIds }, entityType: 'team' },
            select: { tournamentId: true, entityName: true, stage: true },
          })
        : Promise.resolve(
            [] as Array<{
              tournamentId: bigint;
              entityName: string;
              stage: string;
            }>,
          ),

      // Unresolved (open or acknowledged) CvErrorReports, for the per-row
      // "Reported" badge.
      tournamentIds.length
        ? prisma.cvErrorReport.findMany({
            where: { userId, status: { in: ['open', 'acknowledged'] } },
            select: { tournamentIds: true },
          })
        : Promise.resolve([] as Array<{ tournamentIds: string[] }>),

      // Motions, for the analytics join, /cv/motions and the per-round
      // detail on the CV.
      tournamentIds.length
        ? prisma.motion.findMany({
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
        : Promise.resolve([] as CvTaggedMotion[]),

      // Every speaker the tab published for each tournament, projected to two
      // columns — the raw material for the field summary. Bounded by
      // construction: a large tournament publishes ~800 speakers, so even a
      // heavy CV pulls low tens of thousands of (bigint, decimal) pairs. It
      // deliberately does NOT fetch per-round score rows for the field (800
      // speakers × 9 rounds per tournament would be an order of magnitude
      // more, for a round-level percentile nobody has asked for yet).
      includeFieldStats && tournamentIds.length
        ? prisma.tournamentParticipant.findMany({
            where: {
              tournamentId: { in: tournamentIds },
              speakerScoreTotal: { not: null },
              roles: { some: { role: 'speaker' } },
            },
            select: { tournamentId: true, speakerScoreTotal: true, speakerRankOpen: true },
          })
        : Promise.resolve(
            [] as Array<{
              tournamentId: bigint;
              speakerScoreTotal: { toString(): string } | null;
              speakerRankOpen?: number | null;
            }>,
          ),

      // The Open break tab's team names, for the break line. Ingest stores each
      // break tab's rows under its category ('Open', 'ESL', …); one query for
      // every tournament, joined in memory against the round-0 standings
      // already fetched above.
      tournamentIds.length
        ? prisma.eliminationResult.findMany({
            where: { tournamentId: { in: tournamentIds }, entityType: 'team', stage: 'Open' },
            select: { tournamentId: true, entityName: true, stage: true },
          })
        : Promise.resolve([] as Array<{ tournamentId: bigint; entityName: string; stage: string }>),
    ]);

  const openBreakNamesByTournament = new Map<bigint, string[]>();
  for (const r of openBreakRows) {
    if (r.stage !== 'Open') continue;
    const list = openBreakNamesByTournament.get(r.tournamentId) ?? [];
    list.push(r.entityName);
    openBreakNamesByTournament.set(r.tournamentId, list);
  }
  const standingsByTournament = new Map<bigint, StandingLike[]>();
  for (const tr of teamResultRows) {
    if (!tr.teamName || !openBreakNamesByTournament.has(tr.tournamentId)) continue;
    const points = tr.points == null ? null : Number(tr.points.toString());
    const list = standingsByTournament.get(tr.tournamentId) ?? [];
    list.push({
      teamName: tr.teamName,
      points: Number.isFinite(points) ? points : null,
      wins: tr.wins,
    });
    standingsByTournament.set(tr.tournamentId, list);
  }

  const teamOutroundResultByKey = new Map<string, 'won' | 'lost'>();
  for (const r of teamOutroundRows) {
    teamOutroundResultByKey.set(
      `${r.tournamentId}:${r.entityName}:${r.stage}`,
      r.result as 'won' | 'lost',
    );
  }

  const teamOutroundStagesByKey = new Map<string, string[]>();
  for (const r of eudcOutroundRows) {
    const key = `${r.tournamentId}:${r.entityName}`;
    const list = teamOutroundStagesByKey.get(key) ?? [];
    list.push(r.stage);
    teamOutroundStagesByKey.set(key, list);
  }

  // Tournaments the user has filed an unresolved (open or acknowledged)
  // CvErrorReport against. Lets the per-row "Reported" badge render so the
  // user remembers they already flagged the row. Resolved reports
  // (fixed/wont_fix) intentionally don't gate the badge — once the report
  // is closed, the row goes back to its baseline appearance.
  const reportedTournamentIds = new Set<string>();
  {
    const tournamentIdSet = new Set(tournamentIds.map((id) => id.toString()));
    for (const r of openReportRows) {
      for (const id of r.tournamentIds) {
        if (tournamentIdSet.has(id)) reportedTournamentIds.add(id);
      }
    }
  }

  const teammatesByKey = new Map<string, string[]>();
  const teammateDetailsByKey = new Map<string, CvTeammate[]>();
  const toNumber = (v: { toString(): string } | null | undefined): number | null => {
    if (v == null) return null;
    const n = Number(v.toString());
    return Number.isFinite(n) ? n : null;
  };
  for (const tm of teammateRows) {
    if (!tm.teamName) continue;
    const key = `${tm.tournamentId}:${tm.teamName}`;
    if (!myTeamPairKeys.has(key)) continue;
    if (claimedPersonIds.has(tm.personId)) continue;
    // Masked, not raw — a withdrawn debater must not reappear as a
    // teammate name on someone else's CV or public share link.
    const name = displayNameFor(tm.person);
    const list = teammatesByKey.get(key) ?? [];
    list.push(name);
    teammatesByKey.set(key, list);
    const details = teammateDetailsByKey.get(key) ?? [];
    details.push({
      key: `p${tm.personId.toString()}`,
      name,
      speakerScoreTotal: toNumber(tm.speakerScoreTotal),
      roundScores: (tm.speakerRoundScores ?? []).map((s) => ({
        roundNumber: s.roundNumber,
        positionLabel: s.positionLabel,
        score: toNumber(s.score),
      })),
    });
    teammateDetailsByKey.set(key, details);
  }

  const teamPointsByKey = new Map<
    string,
    {
      rank: number | null;
      wins: number | null;
      points: string | null;
      firsts: number | null;
      seconds: number | null;
    }
  >();
  for (const tr of teamResultRows) {
    if (!tr.teamName) continue;
    const key = teamResultKey(tr.tournamentId, tr.teamName);
    if (!myTeamPairKeys.has(key)) continue;
    teamPointsByKey.set(key, {
      rank: tr.rank,
      wins: tr.wins,
      points: tr.points ? tr.points.toString() : null,
      firsts: tr.firsts,
      seconds: tr.seconds,
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

  // Ties, for the "5=" display (I17). The parser stores a tied rank as the bare
  // number, so a tie is derived: a team rank is tied when another team on the
  // same tab holds it; a speaker rank when another speaker has the same total
  // (only known when the field rows were loaded).
  const teamRankHolders = new Map<string, number>();
  for (const [key, rank] of teamRankByKey) {
    const tournamentPart = key.slice(0, key.indexOf(':'));
    const k = `${tournamentPart}#${rank}`;
    teamRankHolders.set(k, (teamRankHolders.get(k) ?? 0) + 1);
  }
  // A speaker tie needs the parser's own rank: the derived ROW_NUMBER rank
  // gives equal totals different numbers, and a tab that split them itself
  // (or gave the other speaker no rank) is not a tie to show.
  const speakersOnTotal = new Map<string, number>();
  for (const row of fieldRows) {
    if (row.speakerScoreTotal == null || row.speakerRankOpen == null) continue;
    const k = `${row.tournamentId}#${Number(row.speakerScoreTotal)}#${row.speakerRankOpen}`;
    speakersOnTotal.set(k, (speakersOnTotal.get(k) ?? 0) + 1);
  }

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
      emailDate: emailDateByTournament.get(tid) ?? null,
      year: t.year,
      format: t.format,
      region: t.region,
      totalTeams: t.totalTeams,
      sourceUrl: publicTournamentUrl(t.sourceUrlRaw),
      myName: myNameByTournament.get(tid) ?? myDisplayName,
      teammates: teamKey ? (teammatesByKey.get(teamKey) ?? []) : [],
      teammateDetails: teamKey ? (teammateDetailsByKey.get(teamKey) ?? []) : [],
      teamName: p.teamName,
      teamRank: teamKey ? (teamRankByKey.get(teamKey) ?? null) : null,
      teamRankTied: (() => {
        const rank = teamKey ? teamRankByKey.get(teamKey) : undefined;
        return rank != null && (teamRankHolders.get(`${tid}#${rank}`) ?? 0) > 1;
      })(),
      teamPoints: tr?.points ?? null,
      teamWins: tr?.wins ?? null,
      teamFirsts: tr?.firsts ?? null,
      teamSeconds: tr?.seconds ?? null,
      speakerAvgScore,
      prelimsSpoken,
      prelimRoundCount: prelimRoundCountByTournament.get(tid) ?? null,
      // Open rank: prefer the parser's value; fall back to the ingest-time
      // ROW_NUMBER(...) over speakerScoreTotal persisted at ingest as
      // speakerRankOpenDerived. Covers BP/AP tabs whose rank header doesn't
      // match the canonical "Rank/#" patterns and whose cell parses to null.
      speakerRankOpen: p.speakerRankOpen ?? p.speakerRankOpenDerived ?? null,
      speakerRankTied:
        p.speakerScoreTotal != null &&
        p.speakerRankOpen != null &&
        (speakersOnTotal.get(`${tid}#${Number(p.speakerScoreTotal)}#${p.speakerRankOpen}`) ?? 0) >
          1,
      speakerRankEsl: p.speakerRankEsl,
      speakerRankEfl: p.speakerRankEfl,
      speakerCategories: p.speakerCategories ?? [],
      teamBreakRank: speakerSignals.teamBreakRank,
      eliminationReached: speakerSignals.eliminationReached,
      eliminationReachedByCategory,
      broke: speakerSignals.broke,
      openBreak: openBreakNamesByTournament.has(tid)
        ? deriveOpenBreak(
            standingsByTournament.get(tid) ?? [],
            openBreakNamesByTournament.get(tid)!,
            p.teamName,
          )
        : null,
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
    const score = (q: typeof p | undefined) =>
      !q
        ? -1
        : (q.judgeTypeTag ? 1 : 0) +
          (q.chairedPrelimRounds ?? 0) +
          (q.lastOutroundChaired ? 5 : 0) +
          (q.lastOutroundPaneled ? 3 : 0);
    if (!existing || score(p) > score(existing)) judgeByTournament.set(p.tournamentId, p);
  }

  // Distinct prelim rounds sat, keyed by ROUND, not by how the row spelled
  // it. One round can reach JudgeAssignment twice: the landing writer and the
  // round-results writer both store it, one with roundNumber set and one
  // (older rows, or a stage cell read without its tooltip) with only the
  // "Round N" label; a claimed alias can hold a second copy too. Keying on
  // `stage:roundNumber` counted "Round 2:2" and "Round 2:" as two rounds.
  // The number is read the same way judgedRoundNumbers reads it below, so
  // the count and the list of rounds agree; only an inround with no number
  // anywhere falls back to its label.
  const judgeInroundsByTournament = new Map<bigint, Set<string>>();
  for (const a of judgeAssignmentRows) {
    if (!claimedPersonIds.has(a.personId)) continue;
    if (classifyRoundLabel(a.stage) !== 'inround') continue;
    const n = a.roundNumber ?? Number((a.stage ?? '').match(/\d+/)?.[0]);
    const key = Number.isFinite(n) ? `#${n}` : `label:${a.stage ?? ''}`;
    const set = judgeInroundsByTournament.get(a.tournamentId) ?? new Set<string>();
    set.add(key);
    judgeInroundsByTournament.set(a.tournamentId, set);
  }

  // Which rounds the user actually sat on, per tournament. Their own
  // assignments only (claimed persons), never the whole panel list.
  const judgedRoundsByTournament = new Map<bigint, Set<number>>();
  const judgedStagesByTournament = new Map<bigint, Set<string>>();
  for (const a of judgeAssignmentRows) {
    if (!claimedPersonIds.has(a.personId)) continue;
    const kind = classifyRoundLabel(a.stage);
    if (kind === 'inround') {
      const n = a.roundNumber ?? Number((a.stage ?? '').match(/\d+/)?.[0]);
      if (!Number.isFinite(n)) continue;
      const set = judgedRoundsByTournament.get(a.tournamentId) ?? new Set<number>();
      set.add(n);
      judgedRoundsByTournament.set(a.tournamentId, set);
    } else if (kind === 'outround' && a.stage) {
      const set = judgedStagesByTournament.get(a.tournamentId) ?? new Set<string>();
      set.add(a.stage);
      judgedStagesByTournament.set(a.tournamentId, set);
    }
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
      sourceUrl: publicTournamentUrl(t.sourceUrlRaw),
      myName: myNameByTournament.get(tid) ?? myDisplayName,
      judgeTypeTag: p.judgeTypeTag,
      inroundsJudged: stats ? stats.size : null,
      inroundsChaired: p.chairedPrelimRounds,
      judgedRoundNumbers: [...(judgedRoundsByTournament.get(tid) ?? [])].sort((x, y) => x - y),
      judgedOutroundStages: [...(judgedStagesByTournament.get(tid) ?? [])],
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
      sourceUrlRaw: publicTournamentUrl(t.sourceUrlRaw),
    }))
    .sort((a, b) => {
      const ya = a.year ?? -Infinity;
      const yb = b.year ?? -Infinity;
      if (ya !== yb) return yb - ya;
      return a.name.localeCompare(b.name);
    });

  // Motions — fetched in the batched read above.
  const taggedMotions: CvTaggedMotion[] = motionRows;

  // The user's team's outround results, for joining knockout motions to the
  // round the team debated them in. Same rows as the champion check above,
  // narrowed to the team on each speaker row; every other team's results
  // stay server-side.
  const myTeamByTournament = new Map(
    speakerRows.filter((r) => r.teamName).map((r) => [r.tournamentId, r.teamName]),
  );
  const teamOutroundResults: CvTeamOutroundResult[] = teamOutroundRows
    .filter((r) => myTeamByTournament.get(r.tournamentId) === r.entityName)
    .map((r) => ({ tournamentId: r.tournamentId, stage: r.stage, won: r.result === 'won' }));

  // ── Field context ────────────────────────────────────────────────────
  // Summarised from the field rows fetched in the batched read above. The
  // aggregation stays here, next to the speaker rows it compares against.
  const fieldStats: CvFieldStat[] = [];
  if (includeFieldStats && fieldRows.length > 0) {
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
    const myScoredRoundsByTournament = new Map<bigint, number>();
    for (const [tid, p] of speakerByTournament.entries()) {
      // Count the rounds the tab actually scored the user in, so consumers
      // can tell a full draw from a partial one. The 'average' row and
      // round 0 are metadata, not speeches.
      myScoredRoundsByTournament.set(
        tid,
        (p.speakerRoundScores ?? []).filter(
          (s) => s.roundNumber > 0 && s.positionLabel !== 'average' && s.score != null,
        ).length,
      );
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
      const variance = sorted.reduce((s, v) => s + (v - mean) * (v - mean), 0) / sorted.length;
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
        betterThanUser: myTotal == null ? null : sorted.filter((v) => v > myTotal).length,
        userScoredRounds: myScoredRoundsByTournament.get(tournamentId) ?? null,
        prelimRoundCount: divisor,
      });
    }
  }

  const totalTournaments = tournamentIds.length;
  // Breaks are reported per role (owner decision C25/C26): a judged outround
  // is never folded into the speaking count, and each side's rate has its own
  // denominator. A tournament counts once per role.
  const breakSummary = summarizeBreaks(speakerRows, judgeRows);
  const totalRoundsChaired = judgeRows.reduce((s, r) => s + (r.inroundsChaired ?? 0), 0);

  // ── Highlights ───────────────────────────────────────────────────────
  // Auto-derived achievements surfaced above the tables on /cv. Pure
  // functions of the rows we already computed; no extra DB hits.
  const championships = championshipHighlights(speakerRows);

  const { deepestBreaks, topSpeakerFinishes, bestTeamFinish } = placementHighlights(speakerRows);

  // Speaker field size per tournament, so the best rank can read "3rd of 400".
  // Empty when the field was not loaded (includeFieldStats: false).
  const speakerFieldByTournament = new Map<bigint, number>();
  for (const f of fieldRows) {
    if (f.speakerScoreTotal == null) continue;
    speakerFieldByTournament.set(
      f.tournamentId,
      (speakerFieldByTournament.get(f.tournamentId) ?? 0) + 1,
    );
  }
  for (const r of speakerRows)
    r.speakerFieldSize = speakerFieldByTournament.get(r.tournamentId) ?? null;
  const bestSpeakerRank = bestSpeakerRankHighlight(speakerRows);

  const bestSpeakerAverage = speakerRows.reduce<CvHighlights['bestSpeakerAverage']>((best, r) => {
    if (!r.speakerAvgScore) return best;
    const score = Number(r.speakerAvgScore);
    if (!Number.isFinite(score)) return best;
    if (!best || score > best.score) {
      return { tournamentName: r.tournamentName, year: r.year, score };
    }
    return best;
  }, null);

  const outroundsChaired = judgeRows.filter((r) => !!r.lastOutroundChaired).length;
  const adjCoreCount = judgeRows.filter((r) => r.judgeTypeTag === 'core').length;

  const majorEvents = [...speakerRows, ...judgeRows]
    .filter((r) => isMajor(r.tournamentName))
    .map((r) => ({ tournamentName: r.tournamentName, year: r.year }))
    // Dedup by name+year so a user with both a speaker and judge row at the
    // same major doesn't double-count.
    .filter(
      (m, i, all) =>
        i === all.findIndex((x) => x.tournamentName === m.tournamentName && x.year === m.year),
    );

  const allYears = [...speakerRows, ...judgeRows]
    .map((r) => r.year)
    .filter((y): y is number => y != null);
  const activeYears = allYears.length
    ? { from: Math.min(...allYears), to: Math.max(...allYears) }
    : null;

  const highlights: CvHighlights = {
    championships,
    deepestBreaks,
    topSpeakerFinishes,
    bestTeamFinish,
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
    teamOutroundResults,
    fieldStats,
    unmatchedTournaments,
    summary: {
      totalTournaments,
      speakingBreaks: breakSummary.speaking,
      judgingBreaks: breakSummary.judging,
      tournamentsSpoken: breakSummary.tournamentsSpoken,
      tournamentsJudged: breakSummary.tournamentsJudged,
      totalRoundsChaired,
    },
    highlights,
    lastIngestedAt: urls.reduce<Date | null>(
      (latest, u) => (u.ingestedAt && (!latest || u.ingestedAt > latest) ? u.ingestedAt : latest),
      null,
    ),
  };
}
