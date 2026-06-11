import type { CvSpeakerRow, CvJudgeRow } from '@/lib/cv/buildCvData';

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
    judgeTournaments: number;
    judgeWithYear: number;
  };
};

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
}): CvAnalytics {
  const { speakerRows, judgeRows } = input;

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
    judgingYearTrend,
    coverage: {
      speakerTournaments: speakerRows.length,
      speakerWithYear: speakerRows.filter((r) => r.year != null).length,
      speakerWithAvgScore: speakerRows.filter((r) => numericAvg(r) != null).length,
      speakerWithRoundScores: speakerRows.filter((r) => r.roundScores.some((s) => s.score != null)).length,
      judgeTournaments: judgeRows.length,
      judgeWithYear: judgeRows.filter((r) => r.year != null).length,
    },
  };
}
