/**
 * Splits over the round table: seat, motion type, flags — any key a round
 * carries. Used by the sections that /cv/stats gained with filtering
 * (positions per format, motion types, info-slide dependence).
 *
 * Deltas are per-format residuals. A win means 1st of four in BP and 1st of
 * two in a two-team format, and circuits score on different scales, so a
 * single career baseline makes every BP row look weak and every two-team row
 * strong. Instead each round is measured against the user's own figure in
 * that round's format (score − format mean, won − format win rate), and a
 * row's delta is the mean of its rounds' residuals. A row that spans formats
 * — "Policy motions" across BP and Asian Parliamentary — stays honest.
 *
 * The baseline is the user's WHOLE record in that format, passed separately
 * from the rounds being split. Under a filter the rows are a slice, and a
 * baseline built from the slice compares a seat with itself: filtered to OG,
 * every OG delta read 0.0.
 *
 * A round's format for this purpose is the one its seat names ('BP:OG' is a
 * BP room whatever the tab's format column says), else the tab's format.
 *
 * Prelim rounds only: seats and motions are read over prelims, where every
 * team debates every round.
 */

import type { RoundFact } from '@/lib/cv/statsFacts';
import { formatAbbrev } from '@/lib/calicotab/format';

/** Below this many rounds a row is shown but marked thin. Matches MIN_QUIRK_ROUNDS. */
export const MIN_SPLIT_ROUNDS = 6;

export type RoundSplit = {
  key: string;
  rounds: number;
  tournaments: number;
  speeches: number;
  avgScore: number | null;
  /** Mean of (score − your mean score in that round's format). */
  scoreDelta: number | null;
  decided: number;
  wins: number;
  winRate: number | null;
  /** Mean of (won − your win rate in that round's format), in percentage points. */
  winRateDelta: number | null;
  /** BP team points; two-team rounds carry none and are not counted. */
  avgPoints: number | null;
  /** Fewer than MIN_SPLIT_ROUNDS rounds — or scored speeches, or decided rounds, where there are any. */
  thin: boolean;
};

/** 'BP' for a 'BP:OG' seat; the tab's format abbreviation otherwise. */
export const formatKey = (r: RoundFact) => r.seat?.split(':')[0] ?? formatAbbrev(r.format) ?? '';

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null);

function formatBaselines(rounds: RoundFact[]) {
  const byFormat = new Map<string, { scores: number[]; decided: number; wins: number }>();
  for (const r of rounds) {
    const f = formatKey(r);
    const b = byFormat.get(f) ?? { scores: [], decided: 0, wins: 0 };
    if (r.score != null) b.scores.push(r.score);
    if (r.won != null) {
      b.decided += 1;
      if (r.won) b.wins += 1;
    }
    byFormat.set(f, b);
  }
  return new Map(
    [...byFormat].map(([f, b]) => [
      f,
      { score: mean(b.scores), winRate: b.decided ? b.wins / b.decided : null },
    ]),
  );
}

export function splitRounds(
  rounds: RoundFact[],
  keyOf: (r: RoundFact) => string | null,
  baselineRounds: RoundFact[] = rounds,
): RoundSplit[] {
  const prelims = rounds.filter((r) => !r.isOutround);
  const baselines = formatBaselines(baselineRounds.filter((r) => !r.isOutround));

  const groups = new Map<string, RoundFact[]>();
  for (const r of prelims) {
    const key = keyOf(r);
    if (key == null) continue;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  return [...groups].map(([key, rows]) => {
    const scores = rows.flatMap((r) => (r.score != null ? [r.score] : []));
    const decidedRows = rows.filter((r) => r.won != null);
    const wins = decidedRows.filter((r) => r.won).length;
    const points = rows.flatMap((r) => (r.points != null ? [r.points] : []));

    const scoreResiduals = rows.flatMap((r) => {
      const base = baselines.get(formatKey(r))?.score;
      return r.score != null && base != null ? [r.score - base] : [];
    });
    const winResiduals = decidedRows.flatMap((r) => {
      const base = baselines.get(formatKey(r))?.winRate;
      return base != null ? [(r.won ? 1 : 0) - base] : [];
    });
    const winDelta = mean(winResiduals);

    return {
      key,
      rounds: rows.length,
      tournaments: new Set(rows.map((r) => r.tournamentId)).size,
      speeches: scores.length,
      avgScore: mean(scores),
      scoreDelta: mean(scoreResiduals),
      decided: decidedRows.length,
      wins,
      winRate: decidedRows.length ? wins / decidedRows.length : null,
      winRateDelta: winDelta == null ? null : winDelta * 100,
      avgPoints: mean(points),
      thin:
        rows.length < MIN_SPLIT_ROUNDS ||
        (scores.length > 0 && scores.length < MIN_SPLIT_ROUNDS) ||
        (decidedRows.length > 0 && decidedRows.length < MIN_SPLIT_ROUNDS) ||
        (scores.length === 0 && decidedRows.length === 0),
    };
  });
}
