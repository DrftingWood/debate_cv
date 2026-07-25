import type {
  CvSpeakerRow,
  CvJudgeRow,
  CvTaggedMotion,
  CvFieldStat,
} from '@/lib/cv/buildCvData';
import { canonicalPosition } from '@/lib/cv/computeCvAnalytics';

/**
 * The deep statistics layer for a speaker's record.
 *
 * `computeCvAnalytics` answers "how did the seasons go?" — a handful of
 * top-line slices. This module answers the questions a debater actually
 * argues about after a tournament: am I consistent, do I start slow, is CG
 * really my worst seat, does my average mean anything against the field I
 * was in, and which motion types do I quietly lose on.
 *
 * Three rules govern everything below, and they are the reason this is a
 * separate module rather than more branches inside the analytics one:
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
};

export type FieldContext = {
  placements: FieldPlacement[];
  /** Mean percentile across tournaments where it could be computed. */
  meanPercentile: number | null;
  bestPlacement: FieldPlacement | null;
  /** Mean of (userAvg − fieldMeanAvg) across tournaments. */
  meanDelta: number | null;
  /** Mean z-score across tournaments. */
  meanZ: number | null;
  /** Total speakers the user has been ranked against across the CV. */
  speakersFaced: number;
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

export type ResultsProfile = {
  decidedRounds: number;
  wins: number;
  winRate: number | null;
  /** Count of rounds finishing on each BP team-points value. */
  pointsDistribution: { points: number; rounds: number }[];
  avgPoints: number | null;
  longestWinStreak: number;
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

/** Chronological order for streaks: oldest tournament first, then round. */
function chronological(rows: CvSpeakerRow[]): CvSpeakerRow[] {
  return [...rows].sort((a, b) => {
    const ya = a.year ?? -Infinity;
    const yb = b.year ?? -Infinity;
    if (ya !== yb) return ya - yb;
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
  const speakerRows = input.speakerRows;
  const judgeRows = input.judgeRows;
  const motions = input.taggedMotions ?? [];
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
    });
  }
  placements.sort((a, b) => (b.year ?? -Infinity) - (a.year ?? -Infinity));

  const withPercentile = placements.filter((p) => p.percentile != null);
  const fieldContext: FieldContext = {
    placements,
    meanPercentile: mean(withPercentile.map((p) => p.percentile!)),
    bestPlacement: withPercentile.reduce<FieldPlacement | null>(
      (best, p) => (!best || p.percentile! > best.percentile! ? p : best),
      null,
    ),
    meanDelta: mean(placements.map((p) => p.delta).filter((d): d is number => d != null)),
    meanZ: mean(placements.map((p) => p.z).filter((z): z is number => z != null)),
    speakersFaced: placements.reduce((s, p) => s + p.speakerCount, 0),
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

    for (const roundNumber of debatedRounds) {
      const result = resultByRound.get(roundNumber) ?? null;
      const score = scoreByRound.get(roundNumber) ?? null;
      const won = result?.won ?? null;
      const points = result?.points ?? null;

      if (won != null) {
        decidedRounds += 1;
        if (won) wins += 1;
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
    const tournamentDecided = [...resultByRound.values()].filter((r) => r.won != null);
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
      if (tr.won == null) continue;
      if (tr.won) {
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
  const finals = speakerRows.filter(
    (r) => r.eliminationReached != null && /final/i.test(r.eliminationReached) && !/quarter|semi|octo|partial|double|triple/i.test(r.eliminationReached),
  ).length;

  const results: ResultsProfile = {
    decidedRounds,
    wins,
    winRate: careerWinRate,
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
    roundDynamics,
    results,
    splits,
    partners,
    coverage: {
      tournaments: speakerRows.length,
      withRoundScores: speakerRows.filter((r) => r.roundScores.some((s) => s.score != null)).length,
      withPositions: speakerRows.filter((r) => r.teamRoundResults.some((tr) => tr.position != null))
        .length,
      withRoundResults: speakerRows.filter((r) => r.teamRoundResults.some((tr) => tr.won != null))
        .length,
      withFieldContext: placements.length,
      withMotions: new Set(
        motions.map((m) => m.tournamentId.toString()),
      ).size,
      withTaggedMotions: new Set(
        motions.filter((m) => m.motionType || m.topic).map((m) => m.tournamentId.toString()),
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

// ── Deepest outround ──────────────────────────────────────────────────────

// Ordered shallow → deep. Matched as a substring against the tab's own
// label, so "ESL Grand Final" and "Grand Final" both land on the last entry.
const STAGE_ORDER = [
  'partial double octofinal',
  'triple octofinal',
  'double octofinal',
  'octofinal',
  'quarterfinal',
  'semifinal',
  'final',
];

function stageDepth(label: string): number {
  const norm = label.toLowerCase();
  let depth = -1;
  STAGE_ORDER.forEach((stage, i) => {
    if (norm.includes(stage)) depth = Math.max(depth, i);
  });
  return depth;
}

function pickDeepestOutround(rows: CvSpeakerRow[]): string | null {
  let best: { label: string; depth: number } | null = null;
  for (const row of rows) {
    if (!row.eliminationReached) continue;
    const depth = stageDepth(row.eliminationReached);
    if (!best || depth > best.depth) best = { label: row.eliminationReached, depth };
  }
  return best?.label ?? null;
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
  const { scoreProfile, roundDynamics, results, splits, fieldContext } = stats;

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

  // Standing against the field.
  if (fieldContext.meanPercentile != null && fieldContext.placements.length >= 3) {
    quirks.push({
      id: 'field-percentile',
      text: `Across your tournaments you finish in the top ${pct(100 - fieldContext.meanPercentile)} of the speaker tab on average.`,
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
        text: `You win ${Math.round(strongest.winRateDelta!)} points more often on ${strongest.key} motions than your overall rate.`,
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
              ? `Your round win rate drops ${Math.round(gap)} points at ${biggest.key.toLowerCase()} compared with ${smallest.key.toLowerCase()}.`
              : `Your round win rate rises ${Math.round(Math.abs(gap))} points at ${biggest.key.toLowerCase()} compared with ${smallest.key.toLowerCase()}.`,
          basis: `${smallest.decidedRounds} and ${biggest.decidedRounds} decided rounds respectively`,
          tone: gap > 0 ? 'neg' : 'pos',
        });
      }
    }
  }

  // Streaks — only interesting once they are long enough to be unlikely.
  if (results.longestWinStreak >= 5) {
    quirks.push({
      id: 'streak',
      text: `Your longest run of won rounds is ${results.longestWinStreak}.`,
      basis: `${results.decidedRounds} decided rounds on record`,
      tone: 'pos',
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
