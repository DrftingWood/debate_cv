import type {
  CvSpeakerRow,
  CvJudgeRow,
  CvTaggedMotion,
  CvFieldStat,
} from '@/lib/cv/buildCvData';
import { outroundRank } from '@/lib/calicotab/judgeStats';
import {
  isFourTeam,
  isStraights,
  OUTCOME_COPY,
  outcomeKind,
  roundFirst,
  roundHit,
  type OutcomeKind,
} from '@/lib/cv/roundOutcome';
import { breakDepth, breakSeed, formatTopPercent, teamTabPlacement } from '@/lib/cv/teamPlacement';

/**
 * The deep statistics layer for a speaker's record.
 *
 * This answers the questions a debater actually argues about after a
 * tournament: am I consistent, do I start slow, is CG really my worst seat,
 * does my average mean anything against the field I was in, which motion
 * types do I quietly lose on, and how did the seasons go.
 *
 * It used to be two modules. `computeCvAnalytics` came first and produced
 * eight top-line slices; this one was written later and re-derived seven of
 * them from the same rows with more care (sample counts, baselines, deltas),
 * so the page ended up computing every split twice and rendering only one
 * copy. The dead half is gone and the two genuinely distinct outputs — the
 * per-season speaking and judging trends — moved here, which is why
 * `seasons` and `judgingSeasons` sit alongside `splits.byYear` despite
 * keying on the same year. They answer different questions: a split is
 * per-ROUND (rounds, win rate, mean score), a season is per-TOURNAMENT
 * (events entered, breaks, best rank), and averaging tournament averages is
 * not the same number as averaging rounds.
 *
 * Three rules govern everything below:
 *
 *  1. **Pure.** Input is the rows `buildCvData` already produced; there are
 *     no queries here. Every figure is reproducible from those rows, which
 *     makes the whole surface unit-testable with synthetic data.
 *  2. **Sample size travels with the number.** Every aggregate carries the
 *     count it was computed from. A 100% win rate over two rounds is not a
 *     statistic, and the UI can only refuse to dramatise it if the count is
 *     in the payload.
 *  3. **No inference.** Nothing here interprets a debater's style. A split
 *     reports rounds, win rate and mean score with a delta against the
 *     user's own baseline. The delta is arithmetic, not a personality
 *     claim — see the product brief's "growth and quirks" rule.
 *
 * Known limits, deliberately not papered over:
 *  - Speech scores are compared across tournaments. Different circuits
 *    scale differently; the field-relative section exists precisely because
 *    the raw cross-tournament mean is the weaker measure.
 *  - Round outcomes come from team results, so a "win rate" is the team's,
 *    not the individual's.
 *  - Motion joins are by (tournament, round). Formats that run more than
 *    one motion per round credit every motion in that round, because
 *    without per-room draw data there is no way to know which one was
 *    debated — the alternative (crediting none) would silently drop rounds.
 */

// ── Shared shapes ──────────────────────────────────────────────────────────

/** Minimum rounds before a split is allowed to headline a quirk. */
export const MIN_QUIRK_ROUNDS = 6;
/** Minimum tournaments before a tournament-level quirk is allowed. */
export const MIN_QUIRK_TOURNAMENTS = 4;
/**
 * Run length that becomes a "streak" finding. Five in every format (most
 * comps run five prelims; owner decision). Only in-rounds count, never
 * outrounds.
 */
const STREAK_BAR = 5;

export type Split = {
  /** The dimension value: "CG", "British Parliamentary", "THW", 2024… */
  key: string;
  /** Prelim rounds contributing to this bucket. */
  rounds: number;
  /** Distinct tournaments contributing. */
  tournaments: number;
  /** Rounds with a recorded team outcome. */
  decidedRounds: number;
  wins: number;
  /** wins / decidedRounds, 0..1; null when nothing was decided. */
  winRate: number | null;
  /** Mean of the user's own speaker scores in these rounds. */
  avgScore: number | null;
  /** avgScore − career mean score. Null when either side is missing. */
  scoreDelta: number | null;
  /** winRate − career win rate, in percentage POINTS (not a ratio). */
  winRateDelta: number | null;
  /** Mean team points per round (BP: 0–3). */
  avgPoints: number | null;
};

export type ScoreBin = { from: number; to: number; count: number };

export type ScoreProfile = {
  /** Individual scored speeches behind every figure in this block. */
  speeches: number;
  mean: number | null;
  median: number | null;
  /** Population standard deviation — the consistency figure. */
  stdev: number | null;
  min: number | null;
  max: number | null;
  /** 10th / 25th / 75th / 90th percentile of scored speeches. */
  p10: number | null;
  q1: number | null;
  q3: number | null;
  p90: number | null;
  /** q3 − q1: the width of the middle half of the user's speeches. */
  iqr: number | null;
  bins: ScoreBin[];
  /** Index into `bins` containing the mean; for highlighting. */
  meanBinIndex: number | null;
  best: ScoredSpeech | null;
  worst: ScoredSpeech | null;
};

export type ScoredSpeech = {
  score: number;
  tournamentName: string;
  year: number | null;
  roundNumber: number;
  /** Motion debated that round, when the tab released one. */
  motion: string | null;
};

export type FieldPlacement = {
  tournamentId: string;
  tournamentName: string;
  year: number | null;
  speakerCount: number;
  /** The user's own tournament average. */
  userAvg: number | null;
  fieldMeanAvg: number | null;
  /** userAvg − fieldMeanAvg, in score units. */
  delta: number | null;
  /** Standard deviations above the field mean. */
  z: number | null;
  /** 0..100 — share of the field the user finished above. */
  percentile: number | null;
  /** 1-based placement among speakers, from the tab's own totals. */
  placement: number | null;
  /**
   * The user was scored in fewer rounds than the tournament ran, so their
   * TOTAL is not comparable with a field of full-draw totals even though
   * their per-round average is.
   *
   * This is not a hypothetical: a seeded record with one missed round
   * produced "+3.4 above the field mean, z +1.36 — placed 89th of 89",
   * which is a self-contradictory row. Placement ranks on total score and
   * a missing round sinks it; the average is unaffected. Flagged rows are
   * still shown (the placement is what the tab really published) but they
   * are excluded from the career aggregates below, which would otherwise
   * be dragged by an artifact of attendance rather than performance.
   */
  incompleteDraw: boolean;
};

/**
 * One tournament's TEAM result: where the team finished on the prelim team
 * tab and how far it went in the outrounds. This, not the speaker tab, is
 * the answer to "how high did I place" (owner rule, see lib/cv/teamPlacement.ts).
 */
export type TeamPlacementRow = {
  tournamentId: string;
  tournamentName: string;
  year: number | null;
  teamName: string | null;
  /** 1-based prelim team-tab rank. */
  teamRank: number;
  totalTeams: number;
  /** 0..100 — share of the other teams finished above. */
  percentile: number;
  /** rank / teams × 100: the "top N%". */
  topPercent: number;
  /** Furthest outround reached, as stored; null when the team did not break. */
  outround: string | null;
  /** True when the team won the final of that bracket. */
  won: boolean;
  /** Break seed, and the Open break's size when known. */
  breakRank: number | null;
  breakingTeams: number | null;
};

export type TeamContext = {
  placements: TeamPlacementRow[];
  /** Mean team-tab percentile across tournaments with a usable team rank. */
  meanPercentile: number | null;
  /** 100 − meanPercentile: the average "top N%". */
  meanTopPercent: number | null;
  /** Best share of the field (ties: the bigger field). */
  bestPlacement: TeamPlacementRow | null;
  /** Teams the user's teams were ranked against, summed across the CV. */
  teamsFaced: number;
};

export type FieldContext = {
  /**
   * SPEAKER-tab placements: the user's own total against every speaker. An
   * individual statistic — the team's placement lives in TeamContext.
   */
  placements: FieldPlacement[];
  /**
   * Career aggregates. All four exclude `incompleteDraw` rows — see the
   * note on that flag. `placements` still carries them so the table can
   * show the row and say why it is set aside.
   */
  meanPercentile: number | null;
  bestPlacement: FieldPlacement | null;
  /** Mean of (userAvg − fieldMeanAvg) across tournaments. */
  meanDelta: number | null;
  /** Mean z-score across tournaments. */
  meanZ: number | null;
  /** Total speakers the user has been ranked against across the CV. */
  speakersFaced: number;
  /** How many rows were set aside as incomplete draws. */
  incompleteDraws: number;
};

export type RoundDynamics = {
  /** Mean score at each round number, with the sample behind it. */
  profile: { roundNumber: number; samples: number; avgScore: number }[];
  /** Mean over the first three rounds of each tournament. */
  openingAvg: number | null;
  /** Mean over the last three prelims of each tournament. */
  closingAvg: number | null;
  /** closingAvg − openingAvg. Positive = finishes stronger. */
  momentum: number | null;
  /** Tournaments long enough to contribute to the opening/closing windows. */
  momentumSamples: number;
  /** Mean per-tournament OLS slope of score against round number. */
  slopePerRound: number | null;
  /** Tournaments with enough scored rounds to fit a slope. */
  slopeSamples: number;
  /** Mean within-tournament standard deviation (swing inside one event). */
  withinTournamentStdev: number | null;
  bestRoundNumber: { roundNumber: number; avgScore: number; samples: number } | null;
  worstRoundNumber: { roundNumber: number; avgScore: number; samples: number } | null;
};

/**
 * British Parliamentary results. A BP prelim is never a "win" (owner decision,
 * assumptions I1/C40/C41): the headline is STRAIGHTS — a tournament whose
 * prelim points total is at least 2 x its rounds, i.e. averaging second place
 * or better. Firsts are tracked separately as a strong indicator of breaking.
 */
export type BpResults = {
  /** BP prelim rounds with a placing on record. */
  rounds: number;
  /** Of those, rounds placed 1st. Never called wins. */
  firsts: number;
  firstsRate: number | null;
  /** BP tournaments whose prelim points total and round count are both known. */
  tournaments: number;
  /** Of those, tournaments with points >= 2 x rounds. */
  straights: number;
  straightsRate: number | null;
};

export type ResultsProfile = {
  /** Rounds with a recorded outcome by the format's measure (see lib/cv/roundOutcome.ts). */
  decidedRounds: number;
  /**
   * Rounds that were a "hit": won (two-team) or finished 2nd or better (BP,
   * >= 2 points). The field keeps its name for the many readers; the page copy
   * comes from `outcome`, and a BP round is never described as won.
   */
  wins: number;
  winRate: number | null;
  /** Which wording applies: wins, BP 2nd-or-better rounds, or both. */
  outcome: OutcomeKind;
  /** BP-only figures (straights, firsts); null when no BP round is on record. */
  bp: BpResults | null;
  /** Count of rounds finishing on each BP team-points value. */
  pointsDistribution: { points: number; rounds: number }[];
  avgPoints: number | null;
  /** Longest run of hit rounds (wins, or BP 2nd-or-better rounds). */
  longestWinStreak: number;
  /** Longest run of rounds that were not a hit. */
  longestLossStreak: number;
  /** Tournaments where the user broke, over tournaments spoken at. */
  breaks: number;
  tournamentsSpoken: number;
  breakRate: number | null;
  /** Tournaments reaching a final, and those won. */
  finals: number;
  championships: number;
  /** Deepest outround reached anywhere, as the tab labelled it. */
  deepestOutround: string | null;
};

export type PartnerSplit = {
  name: string;
  tournaments: number;
  breaks: number;
  avgScore: number | null;
  /** avgScore − career mean. */
  scoreDelta: number | null;
  winRate: number | null;
  decidedRounds: number;
};

/**
 * One competitive season, counted in TOURNAMENTS rather than rounds — the
 * unit a debater plans a year in ("I did four this year and broke at two").
 * `splits.byYear` answers the per-round version of the same question.
 */
export type SeasonPoint = {
  year: number;
  tournaments: number;
  /**
   * Mean of the per-tournament speaker averages that year, so a nine-round
   * major and a five-round local weigh the same. Null when no tournament
   * that year published an average.
   */
  avgSpeakerScore: number | null;
  breaks: number;
  /** breaks / tournaments, 0..1. */
  breakRate: number;
  /** Best (lowest) open speaker rank achieved that year. */
  bestSpeakerRank: number | null;
};

/** The judging counterpart to SeasonPoint. */
export type JudgingSeasonPoint = {
  year: number;
  tournaments: number;
  inroundsChaired: number;
  /** Tournaments where the user judged at least one outround. */
  outroundTournaments: number;
};

export type Quirk = {
  /** Stable id so the UI can order or suppress specific ones. */
  id: string;
  /** One factual sentence. Always contains the number it is claiming. */
  text: string;
  /** The sample the claim rests on, rendered as a footnote. */
  basis: string;
  tone: 'pos' | 'neg' | 'neutral';
};

export type SpeakerStats = {
  volume: {
    tournamentsSpoken: number;
    tournamentsJudged: number;
    roundsDebated: number;
    speechesScored: number;
    outroundsDebated: number;
    roundsChaired: number;
    yearsActive: number | null;
    firstYear: number | null;
    lastYear: number | null;
    formats: number;
    partners: number;
  };
  scoreProfile: ScoreProfile;
  fieldContext: FieldContext;
  teamContext: TeamContext;
  roundDynamics: RoundDynamics;
  results: ResultsProfile;
  splits: {
    byPosition: Split[];
    byFormat: Split[];
    byRegion: Split[];
    byMotionType: Split[];
    byMotionTopic: Split[];
    byYear: Split[];
    byFieldSize: Split[];
  };
  seasons: SeasonPoint[];
  judgingSeasons: JudgingSeasonPoint[];
  partners: PartnerSplit[];
  quirks: Quirk[];
  coverage: {
    tournaments: number;
    withRoundScores: number;
    withPositions: number;
    withRoundResults: number;
    withFieldContext: number;
    withMotions: number;
    withTaggedMotions: number;
    withRegion: number;
  };
};

// ── Small numeric helpers ─────────────────────────────────────────────────

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

function stdev(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  const variance = values.reduce((s, v) => s + (v - m) * (v - m), 0) / values.length;
  return Math.sqrt(variance);
}

/** Linear-interpolated quantile over an already-sorted ascending array. */
function quantileSorted(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/**
 * Ordinary least squares slope of y against x. Returns null for fewer than
 * three points or a degenerate x — a two-point "trend" is a line through
 * noise, not a trajectory.
 */
function olsSlope(points: { x: number; y: number }[]): number | null {
  if (points.length < 3) return null;
  const mx = mean(points.map((p) => p.x))!;
  const my = mean(points.map((p) => p.y))!;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) * (p.x - mx);
  }
  if (den === 0) return null;
  return num / den;
}

function numericAvg(row: CvSpeakerRow): number | null {
  if (!row.speakerAvgScore) return null;
  const n = Number(row.speakerAvgScore);
  return Number.isFinite(n) ? n : null;
}

/**
 * Chronological order for streaks: oldest tournament first, then round.
 *
 * Undated tournaments sort to the END, not the start. A row with no year is
 * usually a recent ingest whose landing page didn't expose one; sorting it
 * to -Infinity would splice an unknown event into the middle of the user's
 * earliest season and silently break or extend a run there. Within a season,
 * rows order by the date their private link was emailed; ties fall back to
 * name so the ordering is deterministic across page loads.
 */
function chronological(rows: CvSpeakerRow[]): CvSpeakerRow[] {
  return [...rows].sort((a, b) => {
    const ya = a.year ?? Infinity;
    const yb = b.year ?? Infinity;
    if (ya !== yb) return ya - yb;
    // Within a season, by when the private link was emailed — the only
    // within-season date on record. Rows without one go last in their season.
    const da = a.emailDate ?? '9999';
    const db = b.emailDate ?? '9999';
    if (da !== db) return da < db ? -1 : 1;
    return a.tournamentName.localeCompare(b.tournamentName);
  });
}

// ── Split accumulation ────────────────────────────────────────────────────

type SplitAgg = {
  rounds: number;
  tournaments: Set<string>;
  decided: number;
  wins: number;
  scores: number[];
  points: number[];
};

function emptyAgg(): SplitAgg {
  return { rounds: 0, tournaments: new Set(), decided: 0, wins: 0, scores: [], points: [] };
}

function creditAgg(
  map: Map<string, SplitAgg>,
  key: string | null | undefined,
  input: {
    tournamentId: string;
    won: boolean | null;
    score: number | null;
    points: number | null;
  },
): void {
  if (!key) return;
  const agg = map.get(key) ?? emptyAgg();
  agg.rounds += 1;
  agg.tournaments.add(input.tournamentId);
  if (input.won != null) {
    agg.decided += 1;
    if (input.won) agg.wins += 1;
  }
  if (input.score != null) agg.scores.push(input.score);
  if (input.points != null) agg.points.push(input.points);
  map.set(key, agg);
}

function toSplits(
  map: Map<string, SplitAgg>,
  baseline: { meanScore: number | null; winRate: number | null },
  sort: (a: Split, b: Split) => number,
): Split[] {
  return [...map.entries()]
    .map(([key, agg]) => {
      const avgScore = mean(agg.scores);
      const winRate = agg.decided > 0 ? agg.wins / agg.decided : null;
      return {
        key,
        rounds: agg.rounds,
        tournaments: agg.tournaments.size,
        decidedRounds: agg.decided,
        wins: agg.wins,
        winRate,
        avgScore,
        scoreDelta:
          avgScore != null && baseline.meanScore != null ? avgScore - baseline.meanScore : null,
        winRateDelta:
          winRate != null && baseline.winRate != null ? (winRate - baseline.winRate) * 100 : null,
        avgPoints: mean(agg.points),
      };
    })
    .sort(sort);
}

const byRoundsDesc = (a: Split, b: Split) => b.rounds - a.rounds || a.key.localeCompare(b.key);

// Stable bench order for BP, then two-team sides, then anything novel.
const POSITION_ORDER = ['OG', 'OO', 'CG', 'CO', 'Prop', 'Opp'];

/**
 * Canonicalize the team-position strings Tabbycat results pages use.
 * BP installs emit either the abbreviation ("OG") or the spelled-out
 * column header ("Opening Government"); two-team formats emit a side
 * column with assorted vocabulary ("Proposition", "Gov", "Affirmative").
 * Unrecognized labels pass through trimmed so a novel format still
 * groups consistently rather than vanishing from the slice.
 */
export function canonicalPosition(label: string): string {
  const norm = label.trim().toLowerCase().replace(/\s+/g, ' ');
  if (norm === 'og' || norm === 'opening government' || norm === '1st proposition') return 'OG';
  if (norm === 'oo' || norm === 'opening opposition' || norm === '1st opposition') return 'OO';
  if (norm === 'cg' || norm === 'closing government' || norm === '2nd proposition') return 'CG';
  if (norm === 'co' || norm === 'closing opposition' || norm === '2nd opposition') return 'CO';
  if (/^(prop(osition)?|gov(ernment)?|aff(irmative)?)$/.test(norm)) return 'Prop';
  if (/^(opp(osition)?|neg(ative)?)$/.test(norm)) return 'Opp';
  return label.trim();
}
const byPositionOrder = (a: Split, b: Split) => {
  const ia = POSITION_ORDER.indexOf(a.key);
  const ib = POSITION_ORDER.indexOf(b.key);
  if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
  return a.key.localeCompare(b.key);
};

/**
 * Field-size buckets. Debaters reason about tournaments in these terms
 * ("it was a 40-team local" vs "a 200-team major"), and break rate is not
 * comparable across them — a break at a 24-team novice event and a break at
 * WUDC are different achievements, so they get different rows.
 */
function fieldSizeBucket(totalTeams: number | null): string | null {
  if (totalTeams == null || totalTeams <= 0) return null;
  if (totalTeams < 24) return 'Under 24 teams';
  if (totalTeams < 48) return '24–47 teams';
  if (totalTeams < 100) return '48–99 teams';
  return '100+ teams';
}
const FIELD_SIZE_ORDER = ['Under 24 teams', '24–47 teams', '48–99 teams', '100+ teams'];
const byFieldSizeOrder = (a: Split, b: Split) =>
  FIELD_SIZE_ORDER.indexOf(a.key) - FIELD_SIZE_ORDER.indexOf(b.key);

// ── Main entry point ──────────────────────────────────────────────────────

export function computeSpeakerStats(input: {
  speakerRows: CvSpeakerRow[];
  judgeRows: CvJudgeRow[];
  taggedMotions?: CvTaggedMotion[];
  fieldStats?: CvFieldStat[];
}): SpeakerStats {
  const speakerRows = input.speakerRows.map(prelimScope);
  const judgeRows = input.judgeRows;
  const motions = input.taggedMotions ?? [];
  const spokenTournamentIds = new Set(speakerRows.map((r) => r.tournamentId.toString()));
  const fieldStats = input.fieldStats ?? [];

  // Motions indexed by (tournament, round) for every join below.
  const motionsByRound = new Map<string, CvTaggedMotion[]>();
  for (const m of motions) {
    if (m.roundNumber == null) continue;
    const key = `${m.tournamentId}:${m.roundNumber}`;
    const list = motionsByRound.get(key) ?? [];
    list.push(m);
    motionsByRound.set(key, list);
  }

  // ── Score profile ───────────────────────────────────────────────────
  const allSpeeches: ScoredSpeech[] = [];
  for (const row of speakerRows) {
    for (const s of row.roundScores) {
      if (s.score == null || !Number.isFinite(s.score)) continue;
      const motionRows = motionsByRound.get(`${row.tournamentId}:${s.roundNumber}`) ?? [];
      allSpeeches.push({
        score: s.score,
        tournamentName: row.tournamentName,
        year: row.year,
        roundNumber: s.roundNumber,
        // Only name the motion when the round released exactly one — with
        // several, we cannot say which one produced this score.
        motion: motionRows.length === 1 ? motionRows[0].text : null,
      });
    }
  }
  const scores = allSpeeches.map((s) => s.score);
  const sortedScores = [...scores].sort((a, b) => a - b);
  const scoreMean = mean(scores);
  const bins = buildBins(sortedScores);

  const scoreProfile: ScoreProfile = {
    speeches: scores.length,
    mean: scoreMean,
    median: quantileSorted(sortedScores, 0.5),
    stdev: stdev(scores),
    min: sortedScores[0] ?? null,
    max: sortedScores[sortedScores.length - 1] ?? null,
    p10: quantileSorted(sortedScores, 0.1),
    q1: quantileSorted(sortedScores, 0.25),
    q3: quantileSorted(sortedScores, 0.75),
    p90: quantileSorted(sortedScores, 0.9),
    iqr: (() => {
      const q1 = quantileSorted(sortedScores, 0.25);
      const q3 = quantileSorted(sortedScores, 0.75);
      return q1 != null && q3 != null ? q3 - q1 : null;
    })(),
    bins,
    meanBinIndex:
      scoreMean == null
        ? null
        : (() => {
            const i = bins.findIndex((b) => scoreMean >= b.from && scoreMean < b.to);
            return i === -1 ? (bins.length ? bins.length - 1 : null) : i;
          })(),
    best: allSpeeches.reduce<ScoredSpeech | null>(
      (best, s) => (!best || s.score > best.score ? s : best),
      null,
    ),
    worst: allSpeeches.reduce<ScoredSpeech | null>(
      (worst, s) => (!worst || s.score < worst.score ? s : worst),
      null,
    ),
  };

  // ── Field context ───────────────────────────────────────────────────
  const fieldById = new Map(fieldStats.map((f) => [f.tournamentId.toString(), f]));
  const placements: FieldPlacement[] = [];
  for (const row of speakerRows) {
    const field = fieldById.get(row.tournamentId.toString());
    if (!field) continue;
    const userAvg = numericAvg(row);
    const delta =
      userAvg != null && field.fieldMeanAvg != null ? userAvg - field.fieldMeanAvg : null;
    placements.push({
      tournamentId: row.tournamentId.toString(),
      tournamentName: row.tournamentName,
      year: row.year,
      speakerCount: field.speakerCount,
      userAvg,
      fieldMeanAvg: field.fieldMeanAvg,
      delta,
      z:
        delta != null && field.fieldStdevAvg != null && field.fieldStdevAvg > 0
          ? delta / field.fieldStdevAvg
          : null,
      percentile:
        field.betterThanUser != null && field.speakerCount > 0
          ? (1 - field.betterThanUser / field.speakerCount) * 100
          : null,
      placement: field.betterThanUser != null ? field.betterThanUser + 1 : null,
      incompleteDraw:
        field.userScoredRounds != null &&
        field.prelimRoundCount != null &&
        field.userScoredRounds > 0 &&
        field.userScoredRounds < field.prelimRoundCount,
    });
  }
  placements.sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity));

  const comparable = placements.filter((p) => !p.incompleteDraw);
  const withPercentile = comparable.filter((p) => p.percentile != null);
  const fieldContext: FieldContext = {
    placements,
    meanPercentile: mean(withPercentile.map((p) => p.percentile!)),
    bestPlacement: withPercentile.reduce<FieldPlacement | null>(
      (best, p) => (!best || p.percentile! > best.percentile! ? p : best),
      null,
    ),
    meanDelta: mean(comparable.map((p) => p.delta).filter((d): d is number => d != null)),
    meanZ: mean(comparable.map((p) => p.z).filter((z): z is number => z != null)),
    speakersFaced: comparable.reduce((s, p) => s + p.speakerCount, 0),
    incompleteDraws: placements.length - comparable.length,
  };

  // ── Team context ────────────────────────────────────────────────────
  // How high the user placed is a team-tab fact: prelim team rank against
  // the number of teams. Not affected by a missed round the way the speaker
  // tab is, so nothing is set aside as a partial draw here.
  const teamPlacements: TeamPlacementRow[] = [];
  for (const row of speakerRows) {
    const p = teamTabPlacement(row.teamRank, row.totalTeams);
    if (!p) continue;
    const seed = breakSeed(row);
    teamPlacements.push({
      tournamentId: row.tournamentId.toString(),
      tournamentName: row.tournamentName,
      year: row.year,
      teamName: row.teamName,
      teamRank: p.rank,
      totalTeams: p.of,
      percentile: p.percentile,
      topPercent: p.topPercent,
      outround: breakDepth(row)?.stage ?? null,
      won: row.wonTournament === true,
      breakRank: seed?.rank ?? null,
      breakingTeams: seed?.of ?? null,
    });
  }
  teamPlacements.sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity));
  const teamMeanPercentile = mean(teamPlacements.map((p) => p.percentile));
  const teamContext: TeamContext = {
    placements: teamPlacements,
    meanPercentile: teamMeanPercentile,
    meanTopPercent: teamMeanPercentile == null ? null : 100 - teamMeanPercentile,
    bestPlacement: teamPlacements.reduce<TeamPlacementRow | null>(
      (best, p) =>
        !best ||
        p.topPercent < best.topPercent ||
        (p.topPercent === best.topPercent && p.totalTeams > best.totalTeams)
          ? p
          : best,
      null,
    ),
    teamsFaced: teamPlacements.reduce((s, p) => s + p.totalTeams, 0),
  };

  // ── Round dynamics ──────────────────────────────────────────────────
  const byRoundNumber = new Map<number, number[]>();
  const perTournamentSlopes: number[] = [];
  const perTournamentStdevs: number[] = [];
  const openingScores: number[] = [];
  const closingScores: number[] = [];
  let momentumSamples = 0;

  for (const row of speakerRows) {
    const scored = row.roundScores
      .filter((s) => s.score != null && Number.isFinite(s.score))
      .sort((a, b) => a.roundNumber - b.roundNumber);
    for (const s of scored) {
      const list = byRoundNumber.get(s.roundNumber) ?? [];
      list.push(s.score!);
      byRoundNumber.set(s.roundNumber, list);
    }
    if (scored.length >= 3) {
      const slope = olsSlope(scored.map((s) => ({ x: s.roundNumber, y: s.score! })));
      if (slope != null) perTournamentSlopes.push(slope);
    }
    const sd = stdev(scored.map((s) => s.score!));
    if (sd != null) perTournamentStdevs.push(sd);
    // Opening / closing windows need a tournament long enough for the two
    // not to overlap — below six scored rounds they would share speeches
    // and the "momentum" figure would be comparing a round with itself.
    if (scored.length >= 6) {
      openingScores.push(...scored.slice(0, 3).map((s) => s.score!));
      closingScores.push(...scored.slice(-3).map((s) => s.score!));
      momentumSamples += 1;
    }
  }

  const profile = [...byRoundNumber.entries()]
    .map(([roundNumber, values]) => ({
      roundNumber,
      samples: values.length,
      avgScore: mean(values)!,
    }))
    .sort((a, b) => a.roundNumber - b.roundNumber);

  const openingAvg = mean(openingScores);
  const closingAvg = mean(closingScores);
  // Round-number extremes only consider rounds with a real sample; a single
  // R9 speech is not "your best round".
  const comparableRounds = profile.filter((p) => p.samples >= 2);
  const roundDynamics: RoundDynamics = {
    profile,
    openingAvg,
    closingAvg,
    momentum: openingAvg != null && closingAvg != null ? closingAvg - openingAvg : null,
    momentumSamples,
    slopePerRound: mean(perTournamentSlopes),
    slopeSamples: perTournamentSlopes.length,
    withinTournamentStdev: mean(perTournamentStdevs),
    bestRoundNumber: comparableRounds.reduce<RoundDynamics['bestRoundNumber']>(
      (best, p) => (!best || p.avgScore > best.avgScore ? p : best),
      null,
    ),
    worstRoundNumber: comparableRounds.reduce<RoundDynamics['worstRoundNumber']>(
      (worst, p) => (!worst || p.avgScore < worst.avgScore ? p : worst),
      null,
    ),
  };

  // ── Results, splits, partners ───────────────────────────────────────
  let decidedRounds = 0;
  let wins = 0;
  const outcomeFormats = new Set<string | null>();
  let bpRounds = 0;
  let bpFirsts = 0;
  let bpTournaments = 0;
  let bpStraights = 0;
  const pointsCounts = new Map<number, number>();
  const allPoints: number[] = [];

  const byPosition = new Map<string, SplitAgg>();
  const byFormat = new Map<string, SplitAgg>();
  const byRegion = new Map<string, SplitAgg>();
  const byMotionType = new Map<string, SplitAgg>();
  const byMotionTopic = new Map<string, SplitAgg>();
  const byYear = new Map<string, SplitAgg>();
  const byFieldSize = new Map<string, SplitAgg>();

  type PartnerAgg = {
    tournaments: number;
    breaks: number;
    scores: number[];
    decided: number;
    wins: number;
  };
  const partnerAggs = new Map<string, PartnerAgg>();

  for (const row of speakerRows) {
    const tid = row.tournamentId.toString();
    const scoreByRound = new Map(
      row.roundScores
        .filter((s) => s.score != null && Number.isFinite(s.score))
        .map((s) => [s.roundNumber, s.score!] as const),
    );
    const resultByRound = new Map(row.teamRoundResults.map((tr) => [tr.roundNumber, tr] as const));
    const debatedRounds = new Set([...scoreByRound.keys(), ...resultByRound.keys()]);
    const prelimCount = row.prelimRoundCount;

    // Straights: one verdict per BP tournament, on the prelim points TOTAL.
    if (isFourTeam(row.format)) {
      const prelimResults = row.teamRoundResults.filter(
        (tr) => tr.points != null && (prelimCount == null || tr.roundNumber <= prelimCount),
      );
      const rounds = prelimCount ?? prelimResults.length;
      const tabTotal = row.teamPoints != null ? Number(row.teamPoints) : NaN;
      // The tab's own total wins when it is there; otherwise sum the rounds,
      // but only when every prelim round has points (a missing round would
      // understate the total and fake a miss).
      const total = Number.isFinite(tabTotal)
        ? tabTotal
        : prelimResults.length === rounds
          ? prelimResults.reduce((s, tr) => s + (tr.points as number), 0)
          : null;
      const verdict = isStraights(total, rounds);
      if (verdict != null) {
        bpTournaments += 1;
        if (verdict) bpStraights += 1;
      }
    }

    for (const roundNumber of debatedRounds) {
      const result = resultByRound.get(roundNumber) ?? null;
      const score = scoreByRound.get(roundNumber) ?? null;
      // `won` here is the format's "hit": a win in a two-team room, 2nd or
      // better in a BP one. A BP round is never a win.
      const won = result ? roundHit(row.format, result) : null;
      const points = result?.points ?? null;

      if (won != null) {
        decidedRounds += 1;
        outcomeFormats.add(row.format);
        if (won) wins += 1;
      }
      if (result && isFourTeam(row.format, result.position)) {
        const first = roundFirst(result);
        if (first != null && (prelimCount == null || roundNumber <= prelimCount)) {
          bpRounds += 1;
          if (first) bpFirsts += 1;
        }
      }
      if (points != null) {
        allPoints.push(points);
        pointsCounts.set(points, (pointsCounts.get(points) ?? 0) + 1);
      }

      const credit = { tournamentId: tid, won, score, points };
      creditAgg(byPosition, result?.position ? canonicalPosition(result.position) : null, credit);
      creditAgg(byFormat, row.format ?? 'Unknown', credit);
      creditAgg(byRegion, row.region, credit);
      creditAgg(byYear, row.year != null ? String(row.year) : null, credit);
      creditAgg(byFieldSize, fieldSizeBucket(row.totalTeams), credit);
      for (const m of motionsByRound.get(`${row.tournamentId}:${roundNumber}`) ?? []) {
        creditAgg(byMotionType, m.motionType, credit);
        creditAgg(byMotionTopic, m.topic, credit);
      }
    }

    // Partner splits are per tournament, not per round: a BP team is fixed
    // for the event, and the interesting question is whether the pairing
    // performed, not which round it was.
    const tournamentScores = [...scoreByRound.values()];
    const tournamentDecided = [...resultByRound.values()]
      .map((r) => ({ ...r, won: roundHit(row.format, r) }))
      .filter((r) => r.won != null);
    for (const partner of row.teammates) {
      const agg =
        partnerAggs.get(partner) ?? { tournaments: 0, breaks: 0, scores: [], decided: 0, wins: 0 };
      agg.tournaments += 1;
      if (row.broke) agg.breaks += 1;
      agg.scores.push(...tournamentScores);
      agg.decided += tournamentDecided.length;
      agg.wins += tournamentDecided.filter((r) => r.won).length;
      partnerAggs.set(partner, agg);
    }
  }

  const careerWinRate = decidedRounds > 0 ? wins / decidedRounds : null;
  const baseline = { meanScore: scoreMean, winRate: careerWinRate };

  // Streaks run across the whole career in chronological order. Only
  // decided rounds participate — an unrecorded round breaks nothing, it
  // simply isn't evidence either way.
  let longestWinStreak = 0;
  let longestLossStreak = 0;
  let currentWin = 0;
  let currentLoss = 0;
  for (const row of chronological(speakerRows)) {
    for (const tr of [...row.teamRoundResults].sort((a, b) => a.roundNumber - b.roundNumber)) {
      // In-rounds only: teamRoundResults also carries outrounds.
      if (row.prelimRoundCount != null && tr.roundNumber > row.prelimRoundCount) continue;
      const hit = roundHit(row.format, tr);
      if (hit == null) continue;
      if (hit) {
        currentWin += 1;
        currentLoss = 0;
      } else {
        currentLoss += 1;
        currentWin = 0;
      }
      longestWinStreak = Math.max(longestWinStreak, currentWin);
      longestLossStreak = Math.max(longestLossStreak, currentLoss);
    }
  }

  const breaks = speakerRows.filter((r) => r.broke).length;
  const finals = speakerRows.filter((r) => reachedFinal(r.eliminationReached)).length;

  const results: ResultsProfile = {
    decidedRounds,
    wins,
    winRate: careerWinRate,
    outcome: outcomeKind(outcomeFormats),
    bp:
      bpRounds > 0 || bpTournaments > 0
        ? {
            rounds: bpRounds,
            firsts: bpFirsts,
            firstsRate: bpRounds > 0 ? bpFirsts / bpRounds : null,
            tournaments: bpTournaments,
            straights: bpStraights,
            straightsRate: bpTournaments > 0 ? bpStraights / bpTournaments : null,
          }
        : null,
    pointsDistribution: [...pointsCounts.entries()]
      .map(([points, rounds]) => ({ points, rounds }))
      .sort((a, b) => b.points - a.points),
    avgPoints: mean(allPoints),
    longestWinStreak,
    longestLossStreak,
    breaks,
    tournamentsSpoken: speakerRows.length,
    breakRate: speakerRows.length > 0 ? breaks / speakerRows.length : null,
    finals,
    championships: speakerRows.filter((r) => r.wonTournament === true).length,
    deepestOutround: pickDeepestOutround(speakerRows),
  };

  const partners: PartnerSplit[] = [...partnerAggs.entries()]
    .map(([name, agg]) => {
      const avgScore = mean(agg.scores);
      return {
        name,
        tournaments: agg.tournaments,
        breaks: agg.breaks,
        avgScore,
        scoreDelta: avgScore != null && scoreMean != null ? avgScore - scoreMean : null,
        winRate: agg.decided > 0 ? agg.wins / agg.decided : null,
        decidedRounds: agg.decided,
      };
    })
    .sort((a, b) => b.tournaments - a.tournaments || a.name.localeCompare(b.name));

  const splits = {
    byPosition: toSplits(byPosition, baseline, byPositionOrder),
    byFormat: toSplits(byFormat, baseline, byRoundsDesc),
    byRegion: toSplits(byRegion, baseline, byRoundsDesc),
    byMotionType: toSplits(byMotionType, baseline, byRoundsDesc),
    byMotionTopic: toSplits(byMotionTopic, baseline, byRoundsDesc),
    byYear: toSplits(byYear, baseline, (a, b) => a.key.localeCompare(b.key)),
    byFieldSize: toSplits(byFieldSize, baseline, byFieldSizeOrder),
  };

  // ── Seasons ─────────────────────────────────────────────────────────
  // Per-tournament, not per-round: see the SeasonPoint doc comment for why
  // this coexists with splits.byYear. Undated tournaments drop out of both
  // trends rather than being bucketed into a fake year.
  const rowsByYear = new Map<number, CvSpeakerRow[]>();
  for (const r of speakerRows) {
    if (r.year == null) continue;
    const list = rowsByYear.get(r.year) ?? [];
    list.push(r);
    rowsByYear.set(r.year, list);
  }
  const seasons: SeasonPoint[] = [...rowsByYear.entries()]
    .map(([year, rows]) => {
      const avgs = rows.map(numericAvg).filter((n): n is number => n != null);
      const breaks = rows.filter((r) => r.broke).length;
      const ranks = rows.map((r) => r.speakerRankOpen).filter((n): n is number => n != null);
      return {
        year,
        tournaments: rows.length,
        avgSpeakerScore: mean(avgs),
        breaks,
        breakRate: breaks / rows.length,
        bestSpeakerRank: ranks.length ? Math.min(...ranks) : null,
      };
    })
    .sort((a, b) => a.year - b.year);

  const judgeRowsByYear = new Map<number, CvJudgeRow[]>();
  for (const r of judgeRows) {
    if (r.year == null) continue;
    const list = judgeRowsByYear.get(r.year) ?? [];
    list.push(r);
    judgeRowsByYear.set(r.year, list);
  }
  const judgingSeasons: JudgingSeasonPoint[] = [...judgeRowsByYear.entries()]
    .map(([year, rows]) => ({
      year,
      tournaments: rows.length,
      inroundsChaired: rows.reduce((s, r) => s + (r.inroundsChaired ?? 0), 0),
      outroundTournaments: rows.filter((r) => !!r.lastOutroundJudged).length,
    }))
    .sort((a, b) => a.year - b.year);

  // ── Volume ──────────────────────────────────────────────────────────
  const years = [...speakerRows, ...judgeRows]
    .map((r) => r.year)
    .filter((y): y is number => y != null);
  const roundsDebated = speakerRows.reduce(
    (sum, r) =>
      sum +
      new Set([
        ...r.roundScores.filter((s) => s.score != null).map((s) => s.roundNumber),
        ...r.teamRoundResults.map((tr) => tr.roundNumber),
      ]).size,
    0,
  );

  const volume: SpeakerStats['volume'] = {
    tournamentsSpoken: speakerRows.length,
    tournamentsJudged: judgeRows.length,
    roundsDebated,
    speechesScored: scores.length,
    outroundsDebated: speakerRows.filter((r) => r.eliminationReached != null).length,
    roundsChaired: judgeRows.reduce((s, r) => s + (r.inroundsChaired ?? 0), 0),
    yearsActive: years.length ? Math.max(...years) - Math.min(...years) + 1 : null,
    firstYear: years.length ? Math.min(...years) : null,
    lastYear: years.length ? Math.max(...years) : null,
    formats: new Set(speakerRows.map((r) => r.format).filter(Boolean)).size,
    partners: partnerAggs.size,
  };

  const stats: Omit<SpeakerStats, 'quirks'> = {
    volume,
    scoreProfile,
    fieldContext,
    teamContext,
    roundDynamics,
    results,
    splits,
    seasons,
    judgingSeasons,
    partners,
    coverage: {
      tournaments: speakerRows.length,
      withRoundScores: speakerRows.filter((r) => r.roundScores.some((s) => s.score != null)).length,
      withPositions: speakerRows.filter((r) => r.teamRoundResults.some((tr) => tr.position != null))
        .length,
      withRoundResults: speakerRows.filter((r) => r.teamRoundResults.some((tr) => tr.won != null))
        .length,
      withFieldContext: placements.length,
      // Shares of the SPEAKING record, like every other coverage count here.
      // Motions also arrive for tournaments the user only judged at; counting
      // those printed "66 of 37" on a 73-tournament career.
      withMotions: new Set(
        motions
          .filter((m) => spokenTournamentIds.has(m.tournamentId.toString()))
          .map((m) => m.tournamentId.toString()),
      ).size,
      withTaggedMotions: new Set(
        motions
          .filter((m) => spokenTournamentIds.has(m.tournamentId.toString()))
          .filter((m) => m.motionType || m.topic)
          .map((m) => m.tournamentId.toString()),
      ).size,
      withRegion: speakerRows.filter((r) => r.region != null).length,
    },
  };

  return { ...stats, quirks: deriveQuirks(stats) };
}

// ── Histogram binning ─────────────────────────────────────────────────────

/**
 * Bin a sorted score series for the distribution chart. Speech scores in
 * every mainstream format live on a ~50–100 scale with meaningful whole and
 * half points, so bins are whole points until the spread gets wide enough
 * that whole points would produce an unreadable number of columns.
 */
export function buildBins(sortedScores: number[]): ScoreBin[] {
  if (sortedScores.length === 0) return [];
  const min = Math.floor(sortedScores[0]);
  const max = Math.ceil(sortedScores[sortedScores.length - 1]);
  const span = Math.max(max - min, 1);
  const width = span <= 20 ? 1 : span <= 40 ? 2 : Math.ceil(span / 20);

  // floor(span / width) + 1 bins, so the maximum score gets a bin of its own
  // rather than being clamped into the one below it.
  const binCount = Math.floor(span / width) + 1;
  const bins: ScoreBin[] = [];
  for (let i = 0; i < binCount; i += 1) {
    const from = min + i * width;
    bins.push({ from, to: from + width, count: 0 });
  }
  for (const score of sortedScores) {
    let index = Math.floor((score - min) / width);
    if (index < 0) index = 0;
    if (index >= bins.length) index = bins.length - 1;
    bins[index].count += 1;
  }
  return bins;
}

/**
 * A row cut to its prelim rounds, once the prelim count is known — scores and
 * results alike.
 *
 * Win rate, points, streaks and splits are all "first in the room" figures.
 * Past the prelims a result means advancing, not winning the room, and the
 * TeamResult rows there are keyed by URL number rather than by round. Scores
 * are cut at the same line so the score profile, the splits and the round
 * table (lib/cv/statsFacts.ts) all count the same speeches. With no prelim
 * count every round is kept: there is nothing to cut at.
 */
function prelimScope(row: CvSpeakerRow): CvSpeakerRow {
  const prelims = row.prelimRoundCount;
  if (prelims == null) return row;
  return {
    ...row,
    roundScores: row.roundScores.filter((s) => s.roundNumber <= prelims),
    teamRoundResults: row.teamRoundResults.filter((tr) => tr.roundNumber <= prelims),
  };
}

// ── Deepest outround ──────────────────────────────────────────────────────

/**
 * Deepest outround stage reached anywhere on the CV.
 *
 * Ranking delegates to `outroundRank`, which is the one place in the
 * codebase that knows the stage vocabulary. Do NOT re-derive this with
 * substring matching: "final" is a substring of "quarterfinal",
 * "semifinal" and "octofinal", so any naive `includes('final')` ladder
 * scores every outround identically and silently reports whichever row
 * happened to come first as the deepest.
 */
function pickDeepestOutround(rows: CvSpeakerRow[]): string | null {
  let best: { label: string; rank: number } | null = null;
  for (const row of rows) {
    if (!row.eliminationReached) continue;
    const rank = outroundRank({
      roundLabel: row.eliminationReached,
      roundNumber: null,
      isOutround: true,
    });
    if (!best || rank > best.rank) best = { label: row.eliminationReached, rank };
  }
  return best?.label ?? null;
}

/**
 * Did this row's deepest outround reach the tournament's final?
 *
 * Anchored against `outroundRank('Final')` so both "Final" and "Grand
 * Final" qualify (installs label it either way) while "Quarterfinal" —
 * which contains the substring "final" — correctly does not. Mirrors the
 * champion check in buildCvData.
 */
function reachedFinal(label: string | null): boolean {
  if (!label) return false;
  const rank = outroundRank({ roundLabel: label, roundNumber: null, isOutround: true });
  const finalRank = outroundRank({ roundLabel: 'Final', roundNumber: null, isOutround: true });
  return rank >= finalRank;
}

// ── Quirks ────────────────────────────────────────────────────────────────

/**
 * Factual one-liners derived from the aggregates above.
 *
 * Every quirk must (a) contain the number it claims, (b) clear a minimum
 * sample, and (c) be checkable against the tables on the same page. The
 * product brief bans style inference — "you are a strategic closer" is not
 * something this data can support, whereas "you average 1.4 more in your
 * last three rounds than your first three, over 11 tournaments" is.
 */
export function deriveQuirks(stats: Omit<SpeakerStats, 'quirks'>): Quirk[] {
  const quirks: Quirk[] = [];
  const { scoreProfile, roundDynamics, results, splits, fieldContext, teamContext } = stats;

  const fmt = (n: number, digits = 1) => n.toFixed(digits);
  const pct = (n: number) => `${Math.round(n)}%`;

  // Momentum inside a tournament.
  if (
    roundDynamics.momentum != null &&
    Math.abs(roundDynamics.momentum) >= 0.3 &&
    roundDynamics.momentumSamples >= 3
  ) {
    const up = roundDynamics.momentum > 0;
    quirks.push({
      id: 'momentum',
      text: up
        ? `You finish stronger than you start: your last three prelims average ${fmt(roundDynamics.momentum)} more than your first three.`
        : `You start stronger than you finish: your last three prelims average ${fmt(Math.abs(roundDynamics.momentum))} less than your first three.`,
      basis: `${roundDynamics.momentumSamples} tournaments with six or more scored rounds`,
      tone: up ? 'pos' : 'neg',
    });
  }

  // Consistency, expressed as the width of the middle half of speeches.
  if (scoreProfile.iqr != null && scoreProfile.speeches >= 15 && scoreProfile.median != null) {
    quirks.push({
      id: 'consistency',
      text: `Half of your speeches land within ${fmt(scoreProfile.iqr)} points, between ${fmt(scoreProfile.q1!)} and ${fmt(scoreProfile.q3!)}.`,
      basis: `${scoreProfile.speeches} scored speeches`,
      tone: 'neutral',
    });
  }

  // Standing against the field. How high the user placed is a TEAM-tab
  // question, so the team finding comes first; the speaker-tab one is an
  // individual statistic and says so in its own words.
  if (teamContext.meanTopPercent != null && teamContext.placements.length >= 3) {
    quirks.push({
      id: 'team-percentile',
      text: `Across your tournaments your team finishes in the top ${formatTopPercent(teamContext.meanTopPercent)} of the team tab on average.`,
      basis: `${teamContext.placements.length} tournaments · ${teamContext.teamsFaced.toLocaleString()} teams ranked against`,
      tone: teamContext.meanTopPercent <= 50 ? 'pos' : 'neutral',
    });
  }
  if (fieldContext.meanPercentile != null && fieldContext.placements.length >= 3) {
    quirks.push({
      id: 'field-percentile',
      text: `On the speaker tab, your own scores place you in the top ${pct(100 - fieldContext.meanPercentile)} of speakers on average.`,
      basis: `${fieldContext.placements.length} tournaments · ${fieldContext.speakersFaced.toLocaleString()} speakers ranked against`,
      tone: fieldContext.meanPercentile >= 50 ? 'pos' : 'neutral',
    });
  }

  // Best and worst seat, only when both clear the sample floor.
  const seats = splits.byPosition.filter((s) => s.rounds >= MIN_QUIRK_ROUNDS && s.winRate != null);
  if (seats.length >= 2) {
    const best = seats.reduce((a, b) => (b.winRate! > a.winRate! ? b : a));
    const worst = seats.reduce((a, b) => (b.winRate! < a.winRate! ? b : a));
    if (best.key !== worst.key && best.winRate! - worst.winRate! >= 0.12) {
      quirks.push({
        id: 'seat-spread',
        text: `${best.key} is your strongest seat at ${pct(best.winRate! * 100)} and ${worst.key} your weakest at ${pct(worst.winRate! * 100)}.`,
        basis: `${best.decidedRounds} decided rounds in ${best.key}, ${worst.decidedRounds} in ${worst.key}`,
        tone: 'neutral',
      });
    }
  }

  // Motion-type affinity against the user's own baseline.
  const motionTypes = splits.byMotionType.filter(
    (s) => s.rounds >= MIN_QUIRK_ROUNDS && s.winRateDelta != null,
  );
  if (motionTypes.length > 0) {
    const strongest = motionTypes.reduce((a, b) => (b.winRateDelta! > a.winRateDelta! ? b : a));
    if (strongest.winRateDelta! >= 10) {
      quirks.push({
        id: 'motion-type',
        text:
          results.outcome === 'win'
            ? `You win ${Math.round(strongest.winRateDelta!)} points more often on ${strongest.key} motions than your overall rate.`
            : `Your ${OUTCOME_COPY[results.outcome].rate.toLowerCase()} is ${Math.round(strongest.winRateDelta!)} points higher on ${strongest.key} motions than your overall rate.`,
        basis: `${strongest.decidedRounds} decided rounds on ${strongest.key}`,
        tone: 'pos',
      });
    }
  }

  // Topic weakness — worth surfacing precisely because it is the one users
  // never notice on their own.
  const topics = splits.byMotionTopic.filter(
    (s) => s.rounds >= MIN_QUIRK_ROUNDS && s.scoreDelta != null,
  );
  if (topics.length >= 2) {
    const weakest = topics.reduce((a, b) => (b.scoreDelta! < a.scoreDelta! ? b : a));
    if (weakest.scoreDelta! <= -0.5) {
      quirks.push({
        id: 'topic-weakness',
        text: `${weakest.key} motions cost you ${fmt(Math.abs(weakest.scoreDelta!))} points against your career average.`,
        basis: `${weakest.rounds} rounds on ${weakest.key}`,
        tone: 'neg',
      });
    }
  }

  // Break rate by field size — the "I only break at small events" check,
  // which the raw break count hides completely.
  const sized = splits.byFieldSize.filter((s) => s.tournaments >= 2);
  if (sized.length >= 2) {
    const biggest = sized[sized.length - 1];
    const smallest = sized[0];
    if (biggest.winRate != null && smallest.winRate != null) {
      const gap = (smallest.winRate - biggest.winRate) * 100;
      if (Math.abs(gap) >= 12) {
        quirks.push({
          id: 'field-size',
          text:
            gap > 0
              ? `Your round ${OUTCOME_COPY[results.outcome].rate.toLowerCase()} drops ${Math.round(gap)} points at ${biggest.key.toLowerCase()} compared with ${smallest.key.toLowerCase()}.`
              : `Your round ${OUTCOME_COPY[results.outcome].rate.toLowerCase()} rises ${Math.round(Math.abs(gap))} points at ${biggest.key.toLowerCase()} compared with ${smallest.key.toLowerCase()}.`,
          basis: `${smallest.decidedRounds} and ${biggest.decidedRounds} decided rounds respectively`,
          tone: gap > 0 ? 'neg' : 'pos',
        });
      }
    }
  }

  // Streaks — only interesting once they are long enough to be unlikely. A BP
  // run is 2nd-or-better rounds (never "wins"). Same bar in every format;
  // prelims only.
  if (results.longestWinStreak >= STREAK_BAR) {
    quirks.push({
      id: 'streak',
      text:
        results.outcome === 'win'
          ? `Your longest run of won rounds is ${results.longestWinStreak}.`
          : results.outcome === 'top-two'
            ? `Your longest run of rounds finishing 2nd or better is ${results.longestWinStreak}.`
            : `Your longest run of won or 2nd-or-better rounds is ${results.longestWinStreak}.`,
      basis: `${results.decidedRounds} decided prelim rounds on record`,
      tone: 'pos',
    });
  }

  // Straights — the BP headline. Firsts are named separately (a strong sign of
  // breaking) and are never described as wins.
  if (results.bp && results.bp.tournaments >= MIN_QUIRK_TOURNAMENTS && results.bp.straightsRate != null) {
    quirks.push({
      id: 'straights',
      text: `You went straights (averaging 2nd or better) at ${pct(results.bp.straightsRate * 100)} of your BP tournaments.`,
      basis: `${results.bp.straights} of ${results.bp.tournaments} BP tournaments; ${results.bp.firsts} firsts in ${results.bp.rounds} rounds`,
      tone: results.bp.straightsRate >= 0.5 ? 'pos' : 'neutral',
    });
  }

  // Break conversion.
  if (results.breakRate != null && results.tournamentsSpoken >= MIN_QUIRK_TOURNAMENTS) {
    quirks.push({
      id: 'break-rate',
      text: `You break at ${pct(results.breakRate * 100)} of the tournaments you speak at.`,
      basis: `${results.breaks} of ${results.tournamentsSpoken} tournaments`,
      tone: results.breakRate >= 0.5 ? 'pos' : 'neutral',
    });
  }

  return quirks;
}
