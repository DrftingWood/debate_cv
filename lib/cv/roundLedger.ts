import { formatBaseStageForDisplay } from '@/lib/cv/formatStage';
import { formatAbbrev } from '@/lib/calicotab/format';
import { splitStageLabel } from '@/lib/calicotab/stageLexicon';

/**
 * Pure helpers behind the per-round ledger on /cv.
 *
 * The ledger used to print "R7", add nothing up, and call every BP round Won
 * or Lost. A British Parliamentary room has four teams and no winner in the
 * two-team sense: the round result is a placement worth 3/2/1/0 points. The
 * same screen also gave outrounds a bare round number, when the reader wants
 * to see "Quarterfinals".
 */

/** Outround stages from earliest to latest, as the CV spells them. */
const OUTROUND_LADDER = [
  'Triple Octofinals',
  'Double Octofinals',
  'Octofinals',
  'Quarterfinals',
  'Semifinals',
  'Final',
] as const;

/**
 * A display name for each round number the ledger shows.
 *
 * Prelims read "Round N". An outround's name is not stored per round — the
 * round-results URL only carries a number — so it is counted back from the
 * stage the team's run ended on: its last outround IS that stage, the one
 * before it the stage before, and so on. That holds while the outround
 * numbers are consecutive and the stages are the plain ladder; a partial
 * round ("Pre-quarterfinals"), an unknown stage or a run longer than the
 * ladder falls back to "Round N" rather than guessing a name.
 */
export function ledgerRoundNames(input: {
  roundNumbers: number[];
  prelimRoundCount: number | null;
  eliminationReached: string | null;
}): Map<number, string> {
  const sorted = [...new Set(input.roundNumbers)].sort((a, b) => a - b);
  const names = new Map<number, string>();
  const isPrelim = (n: number) => input.prelimRoundCount == null || n <= input.prelimRoundCount;

  const outrounds = sorted.filter((n) => !isPrelim(n));
  const deepest = formatBaseStageForDisplay(input.eliminationReached);
  const deepestIndex = OUTROUND_LADDER.findIndex((s) => s === deepest);

  for (const n of sorted) {
    if (isPrelim(n)) {
      names.set(n, `Round ${n}`);
      continue;
    }
    // Position of this outround counted from the team's last one.
    const fromEnd = outrounds.length - 1 - outrounds.indexOf(n);
    const stage = deepestIndex < 0 ? undefined : OUTROUND_LADDER[deepestIndex - fromEnd];
    names.set(n, stage ?? `Round ${n}`);
  }
  return names;
}

/**
 * Running team-points total after each round, in round order. A round whose
 * points were not parsed gets no entry (shown blank) and adds nothing, so one
 * missing cell does not blank every round after it.
 */
export function cumulativePoints(
  rounds: Array<{ roundNumber: number; points: number | null }>,
): Map<number, number> {
  const out = new Map<number, number>();
  let total = 0;
  for (const r of [...rounds].sort((a, b) => a.roundNumber - b.roundNumber)) {
    if (r.points == null) continue;
    total += r.points;
    out.set(r.roundNumber, total);
  }
  return out;
}

const BP_SEATS = new Set(['OG', 'OO', 'CG', 'CO']);

/** Is this a four-team room? True on a BP seat, or when the tournament is BP. */
export function isFourTeamRound(input: { position: string | null; format: string | null }): boolean {
  if (input.position && BP_SEATS.has(input.position.toUpperCase())) return true;
  return formatAbbrev(input.format) === 'BP';
}

const PLACEMENTS = ['4th', '3rd', '2nd', '1st'] as const;

/** BP round points (3/2/1/0) as the placement they stand for; null otherwise. */
export function bpPlacement(points: number | null): string | null {
  if (points == null || !Number.isInteger(points) || points < 0 || points > 3) return null;
  return PLACEMENTS[points];
}

/** Stage key for matching: a "Final" and a "Grand Final" are the same last round. */
export function stageKey(label: string | null | undefined): string | null {
  const { stage } = splitStageLabel(label);
  if (!stage) return null;
  return stage === 'grand_final' ? 'final' : stage;
}

/** Category key: no category and "Open" are both the open bracket. */
export function categoryKey(label: string | null | undefined): string {
  const { category } = splitStageLabel(label);
  return !category || category.toLowerCase() === 'open' ? 'open' : category.toLowerCase();
}

/**
 * The motions to show on each ledger row.
 *
 * Prelim motions are stored with their round number, so a row takes the
 * motions whose roundNumber is its own. Outround motions are stored with
 * roundNumber null and only a label ("Quarterfinals", "ESL Grand Final"), so
 * a ledger row named for an outround by ledgerRoundNames takes the motions
 * whose label names the same stage, read by the stage lexicon, in the same
 * break category as the team's run (eliminationReached: "ESL Semifinals" →
 * ESL; a bare stage → the open bracket).
 *
 * A bare stage in eliminationReached ("Semifinals") reads as the open
 * bracket. That is the stored convention: a run in another bracket keeps its
 * category in the string ("ESL Semifinals"; see formatStageForDisplay).
 *
 * When unsure, no motion:
 *   - a run in more than one bracket (`multiCategoryRun`, i.e.
 *     eliminationReachedByCategory is set): ledgerRoundNames counts every
 *     outround back from one bracket's last stage, so an Open Octofinals row
 *     can be named for the ESL ladder, and its stage match would pick the
 *     wrong bracket's motion;
 *   - a tournament with any partial-round motion ("Partial Octofinals",
 *     "Pre-quarterfinals"): the ladder has no partial rung, so a partial round
 *     the team debated would be named for the full stage after it;
 *   - a row whose name fell back to "Round N" is not matched by stage;
 *   - motions under more than one label for the same stage and category
 *     ("Semifinals" and "Open Semifinals", or "Final" and "Grand Final" in
 *     one bracket): none is shown rather than pick one.
 * Several motions under one label stay together, as a prelim's do. A motion
 * with its own round number is never moved onto another row.
 */
export function ledgerMotions<M extends { roundNumber: number | null; roundLabel: string; seq: number }>(input: {
  roundNumbers: number[];
  roundNames: Map<number, string>;
  prelimRoundCount: number | null;
  eliminationReached: string | null;
  multiCategoryRun?: boolean;
  motions: M[];
}): Map<number, M[]> {
  const out = new Map<number, M[]>();
  const teamCategory = categoryKey(input.eliminationReached);
  const unnumbered = input.motions.filter((m) => m.roundNumber == null);
  const hasPartialRound = unnumbered.some((m) => splitStageLabel(m.roundLabel).stage?.startsWith('partial_'));
  const matchByStage = !input.multiCategoryRun && !hasPartialRound;
  for (const n of input.roundNumbers) {
    const direct = input.motions.filter((m) => m.roundNumber === n);
    if (direct.length > 0) {
      out.set(n, direct.sort((a, b) => a.seq - b.seq));
      continue;
    }
    const isOutround = input.prelimRoundCount != null && n > input.prelimRoundCount;
    const name = input.roundNames.get(n);
    const stage = isOutround && matchByStage ? stageKey(name) : null;
    if (!stage) continue;
    const matches = unnumbered.filter(
      (m) => stageKey(m.roundLabel) === stage && categoryKey(m.roundLabel) === teamCategory,
    );
    if (new Set(matches.map((m) => m.roundLabel.trim().toLowerCase())).size !== 1) continue;
    out.set(n, matches.sort((a, b) => a.seq - b.seq));
  }
  return out;
}
