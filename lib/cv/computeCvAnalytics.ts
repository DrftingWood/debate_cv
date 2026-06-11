import type { CvSpeakerRow, CvJudgeRow, CvTaggedMotion } from '@/lib/cv/buildCvData';

/**
 * Pure aggregation layer for the /cv/analytics page. Operates on the rows
 * buildCvData already produced rather than issuing its own queries — the
 * dedup rules (richest participation per tournament, merged break signals)
 * live in one place and analytics inherits them for free. Keeping this a
 * pure function also makes it testable with synthetic rows, matching the
 * computeSpeakerAvg / speakerSignals pattern.
 *
 * Dimensions intentionally limited to what the ingest pipeline actually
 * stores today: year, format, per-round scores, breaks, judging history.
 * Motion type, team position per round, and region need parser/schema
 * work first (the round-results position is parsed but discarded, motions
 * are never fetched) — do not fake those slices from this data.
 */

export type YearTrendPoint = {
  year: number;
  tournaments: number;
  /** Mean of per-tournament speaker averages that year; null when none parsed. */
  avgSpeakerScore: number | null;
  breaks: number;
  /** breaks / tournaments, 0..1. */
  breakRate: number;
  bestSpeakerRank: number | null;
};

export type FormatSlice = {
  /** Tournament.format string, or 'Unknown' when the parser couldn't infer one. */
  format: string;
  tournaments: number;
  avgSpeakerScore: number | null;
  breaks: number;
  breakRate: number;
  bestSpeakerRank: number | null;
};

export type RoundProfilePoint = {
  roundNumber: number;
  /** How many tournaments contributed a score for this round number. */
  samples: number;
  avgScore: number;
};

export type PositionSlice = {
  /** Canonical side label: OG/OO/CG/CO for BP, Prop/Opp for two-team. */
  position: string;
  /** Prelim rounds debated from this position. */
  rounds: number;
  /** Rounds with a recorded outcome (won != null). */
  decidedRounds: number;
  wins: number;
  /** wins / decidedRounds; null when no round recorded an outcome. */
  winRate: number | null;
  /** Mean team points per round from this position (BP: 0–3). */
  avgTeamPoints: number | null;
  /** Mean of the user's own speaker scores in rounds from this position. */
  avgSpeakerScore: number | null;
};

export type RegionSlice = {
  /** Approved Tournament.region tag; untagged tournaments are excluded. */
  region: string;
  tournaments: number;
  avgSpeakerScore: number | null;
  breaks: number;
  breakRate: number;
  bestSpeakerRank: number | null;
};

export type MotionSlice = {
  /** A MOTION_TYPES or MOTION_TOPICS value, depending on the slice. */
  value: string;
  /** Prelim rounds the user debated on a motion carrying this tag. */
  rounds: number;
  decidedRounds: number;
  wins: number;
  winRate: number | null;
  avgSpeakerScore: number | null;
};

export type JudgingYearPoint = {
  year: number;
  tournaments: number;
  inroundsChaired: number;
  /** Tournaments where the user judged at least one outround. */
  outroundTournaments: number;
};

export type CvAnalytics = {
  speakerYearTrend: YearTrendPoint[];
  formatSlices: FormatSlice[];
  roundProfile: RoundProfilePoint[];
  positionSlices: PositionSlice[];
  regionSlices: RegionSlice[];
  motionTypeSlices: MotionSlice[];
  motionTopicSlices: MotionSlice[];
  judgingYearTrend: JudgingYearPoint[];
  /**
   * How much of the CV each aggregate is actually built on. Old or
   * partially-scraped tournaments often lack years, parsed averages, or
   * per-round columns; the page renders these counts next to each chart so
   * a thin sample reads as "based on 4 of 12 tournaments", not as truth.
   */
  coverage: {
    speakerTournaments: number;
    speakerWithYear: number;
    speakerWithAvgScore: number;
    speakerWithRoundScores: number;
    /** Tournaments with at least one per-round team position recorded —
     * only those ingested since PARSER_VERSION 20260611.0 have it. */
    speakerWithPositions: number;
    /** Tournaments carrying an approved region tag. */
    speakerWithRegion: number;
    judgeTournaments: number;
    judgeWithYear: number;
  };
};

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

// Stable display order: BP bench order, then two-team sides, then anything
// novel alphabetically at the end.
const POSITION_ORDER = ['OG', 'OO', 'CG', 'CO', 'Prop', 'Opp'];

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Parse the formatted speakerAvgScore string back to a number, if usable. */
function numericAvg(r: CvSpeakerRow): number | null {
  if (!r.speakerAvgScore) return null;
  const n = Number(r.speakerAvgScore);
  return Number.isFinite(n) ? n : null;
}

export function computeCvAnalytics(input: {
  speakerRows: CvSpeakerRow[];
  judgeRows: CvJudgeRow[];
  /** Optional: motion rows for the motion-type/-topic slices. */
  taggedMotions?: CvTaggedMotion[];
}): CvAnalytics {
  const { speakerRows, judgeRows } = input;
  const taggedMotions = input.taggedMotions ?? [];

  // ── Speaker trend by year ────────────────────────────────────────────
  const byYear = new Map<number, CvSpeakerRow[]>();
  for (const r of speakerRows) {
    if (r.year == null) continue;
    const list = byYear.get(r.year) ?? [];
    list.push(r);
    byYear.set(r.year, list);
  }
  const speakerYearTrend: YearTrendPoint[] = [...byYear.entries()]
    .map(([year, rows]) => {
      const avgs = rows.map(numericAvg).filter((n): n is number => n != null);
      const breaks = rows.filter((r) => r.broke).length;
      const ranks = rows
        .map((r) => r.speakerRankOpen)
        .filter((n): n is number => n != null);
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

  // ── Slices by format ─────────────────────────────────────────────────
  const byFormat = new Map<string, CvSpeakerRow[]>();
  for (const r of speakerRows) {
    const key = r.format ?? 'Unknown';
    const list = byFormat.get(key) ?? [];
    list.push(r);
    byFormat.set(key, list);
  }
  const formatSlices: FormatSlice[] = [...byFormat.entries()]
    .map(([format, rows]) => {
      const avgs = rows.map(numericAvg).filter((n): n is number => n != null);
      const breaks = rows.filter((r) => r.broke).length;
      const ranks = rows
        .map((r) => r.speakerRankOpen)
        .filter((n): n is number => n != null);
      return {
        format,
        tournaments: rows.length,
        avgSpeakerScore: mean(avgs),
        breaks,
        breakRate: breaks / rows.length,
        bestSpeakerRank: ranks.length ? Math.min(...ranks) : null,
      };
    })
    .sort((a, b) => b.tournaments - a.tournaments || a.format.localeCompare(b.format));

  // ── Round-number profile ─────────────────────────────────────────────
  // Average score in R1 vs R2 vs ... across every tournament with per-round
  // columns. Surfaces "starts slow, finishes strong" patterns. Scores from
  // different tournaments share the usual 50–100 speech scale closely
  // enough that the cross-tournament mean is meaningful; the samples count
  // is shown so a single-tournament round (e.g. only one R9) is visibly thin.
  const byRound = new Map<number, number[]>();
  for (const r of speakerRows) {
    for (const s of r.roundScores) {
      if (s.score == null) continue;
      const list = byRound.get(s.roundNumber) ?? [];
      list.push(s.score);
      byRound.set(s.roundNumber, list);
    }
  }
  const roundProfile: RoundProfilePoint[] = [...byRound.entries()]
    .map(([roundNumber, scores]) => ({
      roundNumber,
      samples: scores.length,
      avgScore: mean(scores)!,
    }))
    .sort((a, b) => a.roundNumber - b.roundNumber);

  // ── Slices by team position ──────────────────────────────────────────
  // Joins the team's per-round position with the user's own speaker score
  // for the same round number. Only rounds that have a position contribute;
  // pre-20260611 ingests have none until re-ingested, which the coverage
  // count surfaces.
  const byPosition = new Map<
    string,
    { rounds: number; decided: number; wins: number; points: number[]; scores: number[] }
  >();
  for (const r of speakerRows) {
    const scoreByRound = new Map(
      r.roundScores.filter((s) => s.score != null).map((s) => [s.roundNumber, s.score!]),
    );
    for (const tr of r.teamRoundResults) {
      if (!tr.position) continue;
      const key = canonicalPosition(tr.position);
      const agg =
        byPosition.get(key) ?? { rounds: 0, decided: 0, wins: 0, points: [], scores: [] };
      agg.rounds += 1;
      if (tr.won != null) {
        agg.decided += 1;
        if (tr.won) agg.wins += 1;
      }
      if (tr.points != null) agg.points.push(tr.points);
      const score = scoreByRound.get(tr.roundNumber);
      if (score != null) agg.scores.push(score);
      byPosition.set(key, agg);
    }
  }
  const positionSlices: PositionSlice[] = [...byPosition.entries()]
    .map(([position, agg]) => ({
      position,
      rounds: agg.rounds,
      decidedRounds: agg.decided,
      wins: agg.wins,
      winRate: agg.decided > 0 ? agg.wins / agg.decided : null,
      avgTeamPoints: mean(agg.points),
      avgSpeakerScore: mean(agg.scores),
    }))
    .sort((a, b) => {
      const ia = POSITION_ORDER.indexOf(a.position);
      const ib = POSITION_ORDER.indexOf(b.position);
      if (ia !== -1 || ib !== -1) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      return a.position.localeCompare(b.position);
    });

  // ── Slices by region ─────────────────────────────────────────────────
  // Same metrics as the format slice, keyed on the admin-approved region
  // tag. Untagged tournaments are excluded rather than bucketed as
  // "Unknown" — unlike format (where Unknown is a parser gap worth
  // surfacing), an untagged region just means nobody tagged it yet, and
  // the coverage note carries that signal.
  const byRegion = new Map<string, CvSpeakerRow[]>();
  for (const r of speakerRows) {
    if (!r.region) continue;
    const list = byRegion.get(r.region) ?? [];
    list.push(r);
    byRegion.set(r.region, list);
  }
  const regionSlices: RegionSlice[] = [...byRegion.entries()]
    .map(([region, rows]) => {
      const avgs = rows.map(numericAvg).filter((n): n is number => n != null);
      const breaks = rows.filter((r) => r.broke).length;
      const ranks = rows
        .map((r) => r.speakerRankOpen)
        .filter((n): n is number => n != null);
      return {
        region,
        tournaments: rows.length,
        avgSpeakerScore: mean(avgs),
        breaks,
        breakRate: breaks / rows.length,
        bestSpeakerRank: ranks.length ? Math.min(...ranks) : null,
      };
    })
    .sort((a, b) => b.tournaments - a.tournaments || a.region.localeCompare(b.region));

  // ── Slices by motion tag (type + topic) ──────────────────────────────
  // Joins each round the user debated to that round's motion via
  // (tournamentId, roundNumber), then aggregates per approved tag value.
  // A round counts when the user has either a speaker score or a team
  // result for it. Multiple motions for one round (motion-per-room
  // formats) are all credited — without per-room draw data there is no
  // way to know which one the user actually debated, and crediting none
  // would hide the round entirely.
  const motionsByRound = new Map<string, CvTaggedMotion[]>();
  for (const m of taggedMotions) {
    if (m.roundNumber == null) continue;
    const key = `${m.tournamentId}:${m.roundNumber}`;
    const list = motionsByRound.get(key) ?? [];
    list.push(m);
    motionsByRound.set(key, list);
  }
  type MotionAgg = { rounds: number; decided: number; wins: number; scores: number[] };
  const byType = new Map<string, MotionAgg>();
  const byTopic = new Map<string, MotionAgg>();
  for (const r of speakerRows) {
    const scoreByRound = new Map(
      r.roundScores.filter((s) => s.score != null).map((s) => [s.roundNumber, s.score!]),
    );
    const wonByRound = new Map(r.teamRoundResults.map((tr) => [tr.roundNumber, tr.won]));
    const debatedRounds = new Set([...scoreByRound.keys(), ...wonByRound.keys()]);
    for (const roundNumber of debatedRounds) {
      const motions = motionsByRound.get(`${r.tournamentId}:${roundNumber}`) ?? [];
      const score = scoreByRound.get(roundNumber) ?? null;
      const won = wonByRound.get(roundNumber) ?? null;
      const credit = (map: Map<string, MotionAgg>, value: string | null) => {
        if (!value) return;
        const agg = map.get(value) ?? { rounds: 0, decided: 0, wins: 0, scores: [] };
        agg.rounds += 1;
        if (won != null) {
          agg.decided += 1;
          if (won) agg.wins += 1;
        }
        if (score != null) agg.scores.push(score);
        map.set(value, agg);
      };
      for (const m of motions) {
        credit(byType, m.motionType);
        credit(byTopic, m.topic);
      }
    }
  }
  const toMotionSlices = (map: Map<string, MotionAgg>): MotionSlice[] =>
    [...map.entries()]
      .map(([value, agg]) => ({
        value,
        rounds: agg.rounds,
        decidedRounds: agg.decided,
        wins: agg.wins,
        winRate: agg.decided > 0 ? agg.wins / agg.decided : null,
        avgSpeakerScore: mean(agg.scores),
      }))
      .sort((a, b) => b.rounds - a.rounds || a.value.localeCompare(b.value));
  const motionTypeSlices = toMotionSlices(byType);
  const motionTopicSlices = toMotionSlices(byTopic);

  // ── Judging trend by year ────────────────────────────────────────────
  const judgeByYear = new Map<number, CvJudgeRow[]>();
  for (const r of judgeRows) {
    if (r.year == null) continue;
    const list = judgeByYear.get(r.year) ?? [];
    list.push(r);
    judgeByYear.set(r.year, list);
  }
  const judgingYearTrend: JudgingYearPoint[] = [...judgeByYear.entries()]
    .map(([year, rows]) => ({
      year,
      tournaments: rows.length,
      inroundsChaired: rows.reduce((s, r) => s + (r.inroundsChaired ?? 0), 0),
      outroundTournaments: rows.filter((r) => !!r.lastOutroundJudged).length,
    }))
    .sort((a, b) => a.year - b.year);

  return {
    speakerYearTrend,
    formatSlices,
    roundProfile,
    positionSlices,
    regionSlices,
    motionTypeSlices,
    motionTopicSlices,
    judgingYearTrend,
    coverage: {
      speakerTournaments: speakerRows.length,
      speakerWithYear: speakerRows.filter((r) => r.year != null).length,
      speakerWithAvgScore: speakerRows.filter((r) => numericAvg(r) != null).length,
      speakerWithRoundScores: speakerRows.filter((r) => r.roundScores.some((s) => s.score != null)).length,
      speakerWithPositions: speakerRows.filter((r) =>
        r.teamRoundResults.some((tr) => tr.position != null),
      ).length,
      speakerWithRegion: speakerRows.filter((r) => r.region != null).length,
      judgeTournaments: judgeRows.length,
      judgeWithYear: judgeRows.filter((r) => r.year != null).length,
    },
  };
}
