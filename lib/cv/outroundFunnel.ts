/**
 * The outround funnel: of the tournaments the page shows, how many broke,
 * and how far each break went — quarterfinal, semifinal, final, title.
 *
 * Tournament-level, so it reads the TournamentFact table the partner filter
 * has already narrowed. A seat filter slices tournaments into rounds, and
 * nobody breaks "in OG", so the page withholds this section under one; this
 * module never sees seats.
 *
 * Rungs are CUMULATIVE — "went at least this deep". The tab records only the
 * deepest stage a team reached, not where its bracket started, so a
 * tournament that broke straight to semifinals and one that won a
 * quarterfinal and lost the semi look identical. Counting "reached exactly
 * the quarterfinal" would need the break size, which TournamentFact doesn't
 * carry; counting "at least as deep as a quarterfinal" is knowable, keeps
 * the funnel monotone, and is what the caption says. The cost is that a
 * small break's skipped quarterfinal is counted on that rung.
 *
 * Depth is ranked with outroundRankStrict (the label-only form of
 * outroundRank), never substring matching: "Octofinals" and "Partial
 * Quarterfinals" both contain "final" and neither reached a quarterfinal —
 * a partial round is played BEFORE its full rung (see stageLexicon.ts).
 * Category-prefixed stages ("ESL Final", "Novice Semifinals") rank at their
 * stage, the same rule speakerStats' reachedFinal uses, so the funnel and
 * the headline "finals" figure agree.
 */

import { outroundRankStrict } from '@/lib/calicotab/judgeStats';
import type { TournamentFact } from '@/lib/cv/statsFacts';

export type FunnelRungKey = 'spoken' | 'broke' | 'quarterfinal' | 'semifinal' | 'final' | 'won';

export type FunnelRung = {
  key: FunnelRungKey;
  label: string;
  count: number;
  /**
   * The previous rung's tournaments that COULD be compared — null on the
   * first rung. Not always the previous count: breaks of unknown depth
   * leave the broke → quarterfinal step, and finals with no recorded result
   * leave the final → title step.
   */
  from: number | null;
  /** How many of `from` reached this rung. */
  of: number | null;
};

export type OutroundFunnel = {
  rungs: FunnelRung[];
  /** Broke, but the deepest stage is missing or unreadable (and no title proves it). */
  unknownDepth: number;
  /** Reached a final whose result the tab didn't record. */
  finalsUndecided: number;
};

const rank = (label: string) => outroundRankStrict(label) as number;
const QUARTERFINAL = rank('Quarterfinals');
const SEMIFINAL = rank('Semifinals');
const FINAL = rank('Final');

export function outroundFunnel(tournaments: TournamentFact[]): OutroundFunnel | null {
  if (tournaments.length === 0) return null;

  let broke = 0;
  let unknownDepth = 0;
  let qf = 0;
  let sf = 0;
  let finals = 0;
  let finalsDecided = 0;
  let won = 0;

  for (const t of tournaments) {
    const title = t.won === true;
    // A title is the stronger evidence: buildCvData only sets `won` when the
    // team won the final, so a champion whose stage label is missing or
    // stale ("Semifinals" from an older ingest) still reached the final —
    // and broke, whatever `broke` says.
    if (!t.broke && !title) continue;
    broke += 1;
    const labelled = t.deepestOutround ? outroundRankStrict(t.deepestOutround) : null;
    const depth = title ? Math.max(labelled ?? 0, FINAL) : labelled;
    if (depth == null) {
      unknownDepth += 1;
      continue;
    }
    if (depth >= QUARTERFINAL) qf += 1;
    if (depth >= SEMIFINAL) sf += 1;
    if (depth >= FINAL) {
      finals += 1;
      if (t.won != null) finalsDecided += 1;
      if (title) won += 1;
    }
  }

  const rungs: FunnelRung[] = [
    { key: 'spoken', label: 'Tournaments', count: tournaments.length, from: null, of: null },
    { key: 'broke', label: 'Broke', count: broke, from: tournaments.length, of: broke },
    { key: 'quarterfinal', label: 'Quarterfinal', count: qf, from: broke - unknownDepth, of: qf },
    { key: 'semifinal', label: 'Semifinal', count: sf, from: qf, of: sf },
    { key: 'final', label: 'Final', count: finals, from: sf, of: finals },
    { key: 'won', label: 'Won', count: won, from: finalsDecided, of: won },
  ];

  return { rungs, unknownDepth, finalsUndecided: finals - finalsDecided };
}
