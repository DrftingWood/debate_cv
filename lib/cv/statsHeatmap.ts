/**
 * Topic × motion-type heatmap (spec section 12).
 *
 * Every prelim round the user was scored in, whose motion has both a type
 * (the deterministic classifier) and an approved topic tag, lands in one
 * cell. A cell reports the rounds behind it and the mean of the user's own
 * speaker scores there, against the mean over every round the grid covers.
 *
 * Sample gate: a cell with fewer than MIN_QUIRK_ROUNDS rounds shows its
 * count and no delta. A wrong number looks as fine as a right one, so the
 * grid never headlines a figure it cannot stand behind.
 *
 * Pure and serialisable; the page runs it again on whatever rows the filter
 * leaves, like every other section.
 */

import { MIN_QUIRK_ROUNDS } from '@/lib/cv/speakerStats';
import type { RoundFact } from '@/lib/cv/statsFacts';

export type HeatCell = {
  topic: string;
  type: string;
  /** Scored prelim rounds in this cell. */
  rounds: number;
  /** Distinct tournaments contributing. */
  tournaments: number;
  /** Mean of the user's scores here; null below the gate. */
  avgScore: number | null;
  /** avgScore minus the grid baseline; null below the gate. */
  scoreDelta: number | null;
  /** True when rounds reach MIN_QUIRK_ROUNDS and the figures are shown. */
  enough: boolean;
};

export type TopicTypeHeatmap = {
  topics: string[];
  types: string[];
  cells: HeatCell[];
  /** Mean score over every round the grid covers; the delta baseline. */
  baseline: number | null;
  /** Rounds in the grid. */
  coveredRounds: number;
  /** Scored prelim rounds in the input, tagged or not. */
  scoredRounds: number;
};

export function topicTypeHeatmap(rounds: RoundFact[]): TopicTypeHeatmap {
  const scored = rounds.filter((r) => !r.isOutround && r.score != null);
  const covered = scored.filter((r) => r.motionType != null && r.motionTopic != null);

  const baseline = covered.length === 0 ? null : covered.reduce((s, r) => s + (r.score as number), 0) / covered.length;

  const buckets = new Map<string, { topic: string; type: string; scores: number[]; tournaments: Set<string> }>();
  for (const r of covered) {
    const key = `${r.motionTopic}\u0000${r.motionType}`;
    let b = buckets.get(key);
    if (!b) {
      b = { topic: r.motionTopic as string, type: r.motionType as string, scores: [], tournaments: new Set() };
      buckets.set(key, b);
    }
    b.scores.push(r.score as number);
    b.tournaments.add(r.tournamentId);
  }

  const cells: HeatCell[] = [...buckets.values()].map((b) => {
    const enough = b.scores.length >= MIN_QUIRK_ROUNDS;
    const avg = b.scores.reduce((s, v) => s + v, 0) / b.scores.length;
    return {
      topic: b.topic,
      type: b.type,
      rounds: b.scores.length,
      tournaments: b.tournaments.size,
      avgScore: enough ? avg : null,
      scoreDelta: enough && baseline != null ? avg - baseline : null,
      enough,
    };
  });

  // Rows and columns ordered by how much evidence sits behind them, so the
  // grid opens on the cells that can say something.
  const weight = (pick: (c: HeatCell) => string) => {
    const m = new Map<string, number>();
    for (const c of cells) m.set(pick(c), (m.get(pick(c)) ?? 0) + c.rounds);
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  };

  return {
    topics: weight((c) => c.topic),
    types: weight((c) => c.type),
    cells,
    baseline,
    coveredRounds: covered.length,
    scoredRounds: scored.length,
  };
}
