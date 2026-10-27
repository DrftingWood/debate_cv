/**
 * What counts as a good round, per format.
 *
 * Owner decision (assumptions I1, C40, C41): in British Parliamentary a prelim
 * is never called a "win". A four-team room scores 3/2/1/0 points for
 * 1st/2nd/3rd/4th, and the headline measure is "straights": a team whose point
 * total is at least 2 x its rounds, i.e. averaging second place or better.
 * Firsts are still counted, separately, because they are a strong indicator of
 * breaking. Two-team formats keep "win".
 *
 * So there are three different things, and they must not be mixed up:
 *   - win         a two-team round won (non-BP only);
 *   - first       a BP round placed 1st (3 points) — tracked, never called a win;
 *   - top-two     a BP round placed 1st or 2nd (>= 2 points) — the per-round
 *                 form of the "second or better" pace that straights measures;
 *   - straights   a BP TOURNAMENT whose prelim points total >= 2 x its rounds.
 * A team that scores 3,0,3,0 has 6 points over 4 rounds: two top-two rounds
 * but not straights (6 < 8). That is why straights is judged on the total and
 * not by counting rounds.
 *
 * No parser change: points (and the stored `won`, which for BP means 1st) are
 * already persisted, so nothing here needs a PARSER_VERSION bump.
 */

import { isFourTeamRound } from '@/lib/cv/roundLedger';

type RoundLike = { position?: string | null; points: number | null; won: boolean | null };

/** BP round points at or above this are "second or better". */
export const TOP_TWO_POINTS = 2;
/** Straights: point total >= STRAIGHTS_PER_ROUND x rounds. */
export const STRAIGHTS_PER_ROUND = 2;

/** True when this round was in a four-team (British Parliamentary) room. */
export function isFourTeam(format: string | null | undefined, position?: string | null): boolean {
  return isFourTeamRound({ position: position ?? null, format: format ?? null });
}

/**
 * Did the team have a "good" round by its format's measure: a win in a
 * two-team room, second place or better (>= 2 points) in a four-team one.
 * Null when the result is unknown. For BP a recorded 1st with no points still
 * qualifies (1st is >= 2nd); a recorded non-1st with no points cannot be placed.
 */
export function roundHit(format: string | null | undefined, r: RoundLike): boolean | null {
  if (!isFourTeam(format, r.position)) return r.won;
  if (r.points != null) return r.points >= TOP_TWO_POINTS;
  return r.won === true ? true : null;
}

/** Did a BP round place 1st? Null when it cannot be told. */
export function roundFirst(r: RoundLike): boolean | null {
  if (r.points != null) return r.points === 3;
  return r.won;
}

/**
 * Straights: the points total is at least 2 x the number of rounds. Null when
 * there are no rounds or no total to judge.
 */
export function isStraights(
  pointsTotal: number | null | undefined,
  rounds: number | null | undefined,
): boolean | null {
  if (pointsTotal == null || !Number.isFinite(pointsTotal)) return null;
  if (rounds == null || rounds < 1) return null;
  return pointsTotal >= STRAIGHTS_PER_ROUND * rounds;
}

export type OutcomeKind = 'win' | 'top-two' | 'mixed';

/** Which words a stats page should use for its round outcome, from the rounds it counts. */
export function outcomeKind(formats: Iterable<string | null | undefined>): OutcomeKind {
  let bp = false;
  let other = false;
  for (const f of formats) {
    if (isFourTeam(f)) bp = true;
    else other = true;
  }
  if (bp && other) return 'mixed';
  return bp ? 'top-two' : 'win';
}

/** Page copy per kind. Nothing here ever says a BP round was "won". */
export const OUTCOME_COPY: Record<
  OutcomeKind,
  { rate: string; run: string; rounds: string; deltaNoun: string }
> = {
  win: { rate: 'Win rate', run: 'Longest winning run', rounds: 'rounds won', deltaNoun: 'win' },
  'top-two': {
    rate: '2nd-or-better rate',
    run: 'Longest run of 2nd-or-better rounds',
    rounds: 'rounds finished 2nd or better',
    deltaNoun: '2nd-or-better',
  },
  mixed: {
    rate: 'Win / 2nd-or-better rate',
    run: 'Longest run of wins or 2nd-or-better rounds',
    rounds: 'rounds won (two-team) or finished 2nd or better (BP)',
    deltaNoun: 'win or 2nd-or-better',
  },
};
