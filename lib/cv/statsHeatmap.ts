/**
 * Topic × motion-class heatmap (spec section 12), plus the knockout record
 * by topic and class.
 *
 * "Class" is the classifier's reading of the wording (lib/motions/classify:
 * Policy, Belief, Actor, Stance, Regret, Preference), not the moderator-
 * approved stem tag Motion.motionType (THW, THBT, THS, ...). The two are
 * related but not interchangeable: THS and THO are both Stance, an actor
 * motion ("TH, as X, would") is Actor whatever its stem, and the "Other"
 * stem spreads across several classes. The grid has always used the class;
 * the field on RoundFact is still called `motionType` for history's sake.
 *
 * Every prelim round the user was scored in, whose motion has both a class
 * and an approved topic tag, lands in one cell. A cell reports the rounds
 * behind it and the mean of the user's own speaker scores there, against
 * the mean over every round the section covers.
 *
 * The margins ("all classes" per topic, "all topics" per class) count every
 * round whose topic, or class, is known even when the other one is not —
 * a three-motion round whose options share a topic but differ in stem is
 * still a round on that topic. That is where untagged or disagreeing rounds
 * stop being lost without anything being guessed.
 *
 * Sample gate: a cell or margin with fewer than MIN_QUIRK_ROUNDS rounds
 * shows its count and no delta. A wrong number looks as fine as a right one,
 * so the grid never headlines a figure it cannot stand behind.
 *
 * Pure and serialisable; the page runs it again on whatever rows the filter
 * leaves, like every other section.
 */

import { MIN_QUIRK_ROUNDS } from '@/lib/cv/speakerStats';
import type { KnockoutFact, RoundFact } from '@/lib/cv/statsFacts';

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

/** The round was a choice of motions; they are clubbed into one bucket. */
export type MixedBucket = Omit<HeatCell, 'topic' | 'type'>;

/** One row or column total: every round with this topic (or class), whatever the other. */
export type MarginCell = MixedBucket & { key: string };

/**
 * Where every scored prelim round went. Exclusive and in this order, so the
 * parts add up to `scored`: a round with no motion published is only that,
 * a choice round is only that even if one option is also untagged, and so on.
 */
export type HeatCoverage = {
  scored: number;
  /** Both a topic and a class: in a cell. */
  covered: number;
  /** Options known to differ in topic or class. */
  choice: number;
  /** No motion released for the round is on record. */
  noMotion: number;
  /** A motion released for the round has no approved topic. */
  untagged: number;
  /** A wording the classifier cannot place. */
  unclassified: number;
};

export type TopicTypeHeatmap = {
  /** Choice rounds (several motions that disagree on class or topic), clubbed together. Null when there were none. */
  mixed: MixedBucket | null;
  topics: string[];
  types: string[];
  cells: HeatCell[];
  /** Per-topic totals over every round with that topic, ordered as `topics`. */
  topicTotals: MarginCell[];
  /** Per-class totals over every round with that class, ordered as `types`. */
  typeTotals: MarginCell[];
  /** Mean score over every round the section covers; the delta baseline. */
  baseline: number | null;
  /** Rounds in a cell or in the choice bucket. */
  coveredRounds: number;
  /** Scored prelim rounds in the input, tagged or not. */
  scoredRounds: number;
  coverage: HeatCoverage;
};

function bucketOf(rounds: RoundFact[], baseline: number | null): MixedBucket {
  const enough = rounds.length >= MIN_QUIRK_ROUNDS;
  const avg = rounds.reduce((s, r) => s + (r.score ?? 0), 0) / rounds.length;
  return {
    rounds: rounds.length,
    tournaments: new Set(rounds.map((r) => r.tournamentId)).size,
    avgScore: enough ? avg : null,
    scoreDelta: enough && baseline != null ? avg - baseline : null,
    enough,
  };
}

function groupBy<T>(items: T[], key: (t: T) => string | null | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const item of items) {
    const k = key(item);
    if (k == null) continue;
    out.set(k, [...(out.get(k) ?? []), item]);
  }
  return out;
}

/** Keys ordered by how much evidence sits behind them, so the grid opens on what can say something. */
const byWeight = (m: Map<string, unknown[]>) =>
  [...m.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([k]) => k);

function coverageOf(scored: RoundFact[]): HeatCoverage {
  const c: HeatCoverage = {
    scored: scored.length,
    covered: 0,
    choice: 0,
    noMotion: 0,
    untagged: 0,
    unclassified: 0,
  };
  for (const r of scored) {
    if (!r.hasMotion) c.noMotion += 1;
    else if (r.choiceRound === true) c.choice += 1;
    else if (r.motionTopic == null) c.untagged += 1;
    else if (r.motionType == null) c.unclassified += 1;
    else c.covered += 1;
  }
  return c;
}

export function topicTypeHeatmap(rounds: RoundFact[]): TopicTypeHeatmap {
  const scored = rounds.filter((r) => !r.isOutround && r.score != null);
  const choice = scored.filter((r) => r.choiceRound === true);
  const covered = scored.filter(
    (r) => r.choiceRound !== true && r.motionType != null && r.motionTopic != null,
  );

  // One baseline for every figure in the section, choice rounds and the
  // margins' extra rounds included, so every delta is comparable.
  const inSection = scored.filter(
    (r) => r.choiceRound === true || r.motionType != null || r.motionTopic != null,
  );
  const baseline =
    inSection.length === 0
      ? null
      : inSection.reduce((s, r) => s + (r.score ?? 0), 0) / inSection.length;

  const byCell = groupBy(covered, (r) => `${r.motionTopic}\u0000${r.motionType}`);
  const cells: HeatCell[] = [...byCell.values()].map((rs) => ({
    topic: rs[0].motionTopic as string,
    type: rs[0].motionType as string,
    ...bucketOf(rs, baseline),
  }));

  const byTopic = groupBy(scored, (r) => r.motionTopic);
  const byType = groupBy(scored, (r) => r.motionType);
  const topics = byWeight(byTopic);
  const types = byWeight(byType);

  return {
    mixed: choice.length > 0 ? bucketOf(choice, baseline) : null,
    topics,
    types,
    cells,
    topicTotals: topics.map((key) => ({ key, ...bucketOf(byTopic.get(key) ?? [], baseline) })),
    typeTotals: types.map((key) => ({ key, ...bucketOf(byType.get(key) ?? [], baseline) })),
    baseline,
    coveredRounds: covered.length + choice.length,
    scoredRounds: scored.length,
    coverage: coverageOf(scored),
  };
}

// ── Knockouts ─────────────────────────────────────────────────────────────

/** A knockout record: rounds the team advanced from (or won), and rounds it went out in. */
export type KnockoutLine = { key: string; won: number; lost: number };

export type KnockoutRecord = {
  /** Knockout rounds with a result. */
  rounds: number;
  won: number;
  lost: number;
  byTopic: KnockoutLine[];
  byType: KnockoutLine[];
  /** Knockouts whose options differ in topic or class. Null when none. */
  choice: KnockoutLine | null;
  /** Knockouts with a result but no motion on record for that stage. */
  noMotion: number;
  /** Knockouts with a motion and no single known topic (untagged option, or a choice). */
  noTopic: number;
};

function lines(ks: KnockoutFact[], key: (k: KnockoutFact) => string | null): KnockoutLine[] {
  return byWeight(groupBy(ks, key)).map((k) => {
    const group = ks.filter((x) => key(x) === k);
    const won = group.filter((x) => x.won).length;
    return { key: k, won, lost: group.length - won };
  });
}

/**
 * The knockout record by topic and by class. Counts, not rates: a career
 * has a handful of outrounds, and a W–L line is a fact at any size where a
 * percentage over three rounds would be a claim. So there is no sample gate
 * here; the counts are shown as they are.
 */
export function knockoutRecord(knockouts: KnockoutFact[]): KnockoutRecord {
  const won = knockouts.filter((k) => k.won).length;
  const choice = knockouts.filter((k) => k.choiceRound);
  const choiceWon = choice.filter((k) => k.won).length;
  return {
    rounds: knockouts.length,
    won,
    lost: knockouts.length - won,
    byTopic: lines(knockouts, (k) => k.motionTopic),
    byType: lines(knockouts, (k) => k.motionType),
    choice:
      choice.length > 0 ? { key: 'choice', won: choiceWon, lost: choice.length - choiceWon } : null,
    noMotion: knockouts.filter((k) => !k.hasMotion).length,
    noTopic: knockouts.filter((k) => k.hasMotion && k.motionTopic == null).length,
  };
}
