/**
 * Two views over the round table that a seat filter does not break, because
 * every figure is a fact about one round.
 *
 * Round curve — score and win rate by round number. The engine's round
 * dynamics answer the same question for scores but read whole tournaments in
 * order (openings, closings, slopes), so they are withheld under a seat
 * filter. This curve only groups rounds by their number, so it stays.
 *
 * Carry index — your speech minus your partners' mean speech in the same
 * round, and how the team did when you out-spoke them versus when they
 * out-spoke you. A difference of speaker points inside one room is already
 * format-neutral; the results by bucket use per-format residuals like every
 * other split (lib/cv/roundSplits.ts).
 */

import type { RoundFact } from '@/lib/cv/statsFacts';
import { splitRounds, type RoundSplit } from '@/lib/cv/roundSplits';

/**
 * Within this many speaker points of your partners, a round counts as level.
 * Half a point: tabs score in half or whole points, so a one-point gap is the
 * smallest difference most judges express. On the reference record a ±1 band
 * called 190 of 213 rounds level — 95 of them sat exactly on ±1.
 */
export const CARRY_LEVEL_BAND = 0.5;

export type RoundCurvePoint = RoundSplit & { roundNumber: number };

export function roundCurve(rounds: RoundFact[], baselineRounds: RoundFact[] = rounds): RoundCurvePoint[] {
  return splitRounds(rounds, (r) => String(r.round), baselineRounds)
    .map((s) => ({ ...s, roundNumber: Number(s.key) }))
    .sort((a, b) => a.roundNumber - b.roundNumber);
}

export type CarryBucket = 'out-spoke' | 'level' | 'out-spoken';

export type CarryIndex = {
  /** Prelim rounds where you and at least one partner were scored. */
  rounds: number;
  meanCarry: number | null;
  outSpoke: number;
  level: number;
  outSpoken: number;
  /** Results in each bucket, ordered out-spoke → level → out-spoken. */
  results: RoundSplit[];
};

function carryOf(r: RoundFact): number | null {
  if (r.isOutround || r.score == null || r.partnerScores.length === 0) return null;
  return r.score - r.partnerScores.reduce((s, v) => s + v, 0) / r.partnerScores.length;
}

export function bucketOf(carry: number): CarryBucket {
  // A small epsilon so a carry of exactly the band, stored as 1.0000000001
  // after averaging three-a-side partners, is still level.
  if (carry - CARRY_LEVEL_BAND > 1e-9) return 'out-spoke';
  if (-carry - CARRY_LEVEL_BAND > 1e-9) return 'out-spoken';
  return 'level';
}

const ORDER: CarryBucket[] = ['out-spoke', 'level', 'out-spoken'];

export function carryIndex(rounds: RoundFact[], baselineRounds: RoundFact[] = rounds): CarryIndex {
  const carries = rounds.flatMap((r) => {
    const c = carryOf(r);
    return c == null ? [] : [c];
  });
  const count = (b: CarryBucket) => carries.filter((c) => bucketOf(c) === b).length;

  const results = splitRounds(
    rounds,
    (r) => {
      const c = carryOf(r);
      return c == null ? null : bucketOf(c);
    },
    baselineRounds,
  ).sort((a, b) => ORDER.indexOf(a.key as CarryBucket) - ORDER.indexOf(b.key as CarryBucket));

  return {
    rounds: carries.length,
    meanCarry: carries.length ? carries.reduce((s, v) => s + v, 0) / carries.length : null,
    outSpoke: count('out-spoke'),
    level: count('level'),
    outSpoken: count('out-spoken'),
    results,
  };
}

// ── Momentum after a win or a loss ────────────────────────────────────────

export type MomentumKey = 'after-win' | 'after-loss';

/**
 * The round after a decided prelim, grouped by how that prelim went: do you
 * bounce back from a loss, or carry a win forward?
 *
 * Pairs are consecutive round numbers inside one tournament, both prelims,
 * the earlier one decided. A gap (a bye, a round with no recorded result)
 * breaks the pair rather than bridging it — "the round after" has to be the
 * next round. Results use per-format residuals like every other split.
 *
 * Read with care: tabs power-pair, so a win puts you in a stronger room next
 * round and a loss in a weaker one. Win rate after a win is expected to fall
 * for everyone; the section says so rather than calling it tilt.
 */
export function momentumAfter(rounds: RoundFact[], baselineRounds: RoundFact[] = rounds): RoundSplit[] {
  const prelims = rounds.filter((r) => !r.isOutround);
  const byTournament = new Map<string, Map<number, RoundFact>>();
  for (const r of prelims) {
    const m = byTournament.get(r.tournamentId) ?? new Map<number, RoundFact>();
    m.set(r.round, r);
    byTournament.set(r.tournamentId, m);
  }
  const previous = (r: RoundFact) => byTournament.get(r.tournamentId)?.get(r.round - 1);

  return splitRounds(
    prelims,
    (r) => {
      const prev = previous(r);
      if (prev?.won == null) return null;
      return prev.won ? 'after-win' : 'after-loss';
    },
    baselineRounds,
  ).sort((a, b) => (a.key === 'after-win' ? -1 : 1) - (b.key === 'after-win' ? -1 : 1));
}
