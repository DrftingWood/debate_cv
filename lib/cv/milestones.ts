/**
 * Milestones and records: firsts (tournament, break, final, title), the best
 * single speech, the best speaker-tab and team break ranks, and the longest
 * run of tournaments broken.
 *
 * Read over speaker rows rather than TournamentFact because the best speech
 * needs per-round scores, which the tournament table doesn't carry. The page
 * hands in the rows its partner filter left; under a seat filter the section
 * is withheld (a milestone is a fact about a whole tournament).
 *
 * Ordering is the hard part (risk R1 in the stats task map): tournaments
 * carry a `year` and nothing finer, so the order WITHIN a season is unknown.
 * Everything here is written to claim only what that permits:
 *
 *  - A "first" names a tournament only when it was the sole qualifying one
 *    in the earliest qualifying season. Otherwise it reports the season and
 *    how many qualified that year — picking one by name would present the
 *    alphabet as history.
 *  - The break run is reported as two figures: the run that exists under
 *    EVERY order the seasons allow (certain), and the longest any order
 *    allows (possible). When they agree the run is a fact; when they differ
 *    the page shows the range rather than guessing a point inside it.
 *  - Undated tournaments (year null) are excluded from firsts and runs, and
 *    counted so the caption can say so. They are usually recent ingests
 *    whose tab didn't expose a year, so treating them as early would be the
 *    worse error — the same reasoning as speakerStats' `chronological`.
 *
 * Records (best speech, best ranks) need no ordering; ties list every
 * holder, oldest season first.
 */

import type { CvSpeakerRow } from '@/lib/cv/buildCvData';
import { outroundRankStrict } from '@/lib/calicotab/judgeStats';

export type FirstMilestone = {
  year: number;
  /** Qualifying tournaments in that season. */
  count: number;
  /** Named only when `count` is 1 — order within a season is unknown. */
  tournament: string | null;
};

export type RecordHolder = { tournament: string; year: number | null };

export type Milestones = {
  firstTournament: FirstMilestone | null;
  firstBreak: FirstMilestone | null;
  firstFinal: FirstMilestone | null;
  firstTitle: FirstMilestone | null;
  bestSpeech: { score: number; speeches: number; at: Array<RecordHolder & { round: number }> } | null;
  /** Smallest open speaker-tab rank; `of` = tournaments with a published rank. */
  bestSpeakerRank: { rank: number; of: number; at: RecordHolder[] } | null;
  /** Smallest team break rank; `of` = breaks with a published break rank. */
  bestBreakRank: { rank: number; of: number; at: RecordHolder[] } | null;
  /** Longest run of consecutive tournaments broken; `dated` = tournaments it was read over. */
  breakRun: { certain: number; possible: number; dated: number } | null;
  undated: number;
  /**
   * Undated tournaments that would qualify for each first. A record whose
   * only titles are undated has titles; the section must say so rather than
   * print "none".
   */
  undatedFirsts: Record<'tournament' | 'break' | 'final' | 'title', number>;
};

const FINAL_RANK = outroundRankStrict('Final') as number;

/** Same notion as speakerStats' reachedFinal (Grand Final counts); a title implies it. */
function reachedFinal(row: CvSpeakerRow): boolean {
  if (row.wonTournament === true) return true;
  const rank = row.eliminationReached ? outroundRankStrict(row.eliminationReached) : null;
  return rank != null && rank >= FINAL_RANK;
}

/** A title proves a break even where `broke` is stale — the rule outroundFunnel uses too. */
const title = (row: CvSpeakerRow) => row.wonTournament === true;
const broke = (row: CvSpeakerRow) => row.broke || title(row);

const byYearThenName = (a: RecordHolder, b: RecordHolder) =>
  (a.year ?? Infinity) - (b.year ?? Infinity) || a.tournament.localeCompare(b.tournament);

function firstOf(rows: CvSpeakerRow[], qualifies: (r: CvSpeakerRow) => boolean): FirstMilestone | null {
  const dated = rows.filter((r) => r.year != null && qualifies(r));
  if (dated.length === 0) return null;
  const year = Math.min(...dated.map((r) => r.year as number));
  const that = dated.filter((r) => r.year === year);
  return { year, count: that.length, tournament: that.length === 1 ? that[0].tournamentName : null };
}

function bestRank(rows: CvSpeakerRow[], rankOf: (r: CvSpeakerRow) => number | null) {
  const ranked = rows.flatMap((r) => {
    const rank = rankOf(r);
    return rank != null && rank > 0 ? [{ r, rank }] : [];
  });
  if (ranked.length === 0) return null;
  const rank = Math.min(...ranked.map((x) => x.rank));
  const at = ranked
    .filter((x) => x.rank === rank)
    .map(({ r }) => ({ tournament: r.tournamentName, year: r.year }))
    .sort(byYearThenName);
  return { rank, of: ranked.length, at };
}

/**
 * Bounds on the longest run of consecutive breaks when only the season of
 * each tournament is known. `seasons` is chronological, one [breaks, misses]
 * pair per season.
 *
 * possible — an order that maximises the run puts a season's breaks at
 * whichever edge extends it. A single run touches at most two partially
 * broken seasons (it starts in one's tail and ends in another's head, with
 * whole-broken seasons between), so each season's choice is independent and
 * a linear scan finds the maximum.
 *
 * certain — the smallest longest-run over every order: the largest run the
 * record guarantees. For a cap K, carry the shortest run that can be left
 * open at the end of each season: pack as many breaks as the cap allows onto
 * the open run, hide the rest between misses (each gap between two misses
 * holds up to K), and leave the minimum at the tail. Leaving less open never
 * hurts later seasons, so the greedy decides feasibility exactly; the answer
 * is the smallest feasible K. Checked against brute force in the tests.
 */
export function breakRunBounds(seasons: Array<[breaks: number, misses: number]>): {
  certain: number;
  possible: number;
} {
  let possible = 0;
  let open = 0;
  for (const [b, m] of seasons) {
    if (m === 0) {
      open += b;
      possible = Math.max(possible, open);
    } else {
      possible = Math.max(possible, open + b);
      open = b;
    }
  }

  const fits = (cap: number) => {
    let carry = 0;
    for (const [b, m] of seasons) {
      if (m === 0) {
        carry += b;
        if (carry > cap) return false;
        continue;
      }
      const head = Math.min(cap - carry, b);
      const hidden = m >= 2 ? (m - 1) * cap : 0;
      const tail = Math.max(0, b - head - hidden);
      if (tail > cap) return false;
      carry = tail;
    }
    return true;
  };
  let certain = 0;
  while (certain < possible && !fits(certain)) certain += 1;

  return { certain, possible };
}

export function milestones(rows: CvSpeakerRow[]): Milestones | null {
  const undatedRows = rows.filter((r) => r.year == null);
  const undated = undatedRows.length;

  // Prelim speeches only, by the same rule as statsFacts' prelimScores: an
  // outround score isn't comparable (fewer, stronger rooms, and many tabs
  // don't publish them), and 'average' rows are the tab's summary, not a speech.
  const speeches = rows.flatMap((r) =>
    r.roundScores.flatMap((s) =>
      s.score == null ||
      s.roundNumber <= 0 ||
      s.positionLabel === 'average' ||
      (r.prelimRoundCount != null && s.roundNumber > r.prelimRoundCount)
        ? []
        : [{ score: Number(s.score), tournament: r.tournamentName, year: r.year, round: s.roundNumber }],
    ),
  );
  let bestSpeech: Milestones['bestSpeech'] = null;
  if (speeches.length > 0) {
    const score = Math.max(...speeches.map((s) => s.score));
    const at = speeches
      .filter((s) => s.score === score)
      .map(({ tournament, year, round }) => ({ tournament, year, round }))
      .sort((a, b) => byYearThenName(a, b) || a.round - b.round);
    bestSpeech = { score, speeches: speeches.length, at };
  }

  const datedRows = rows.filter((r) => r.year != null);
  let breakRun: Milestones['breakRun'] = null;
  if (datedRows.some(broke)) {
    const bySeason = new Map<number, [number, number]>();
    for (const r of datedRows) {
      const pair = bySeason.get(r.year as number) ?? [0, 0];
      pair[broke(r) ? 0 : 1] += 1;
      bySeason.set(r.year as number, pair);
    }
    const seasons = [...bySeason].sort((a, b) => a[0] - b[0]).map(([, pair]) => pair);
    breakRun = { ...breakRunBounds(seasons), dated: datedRows.length };
  }

  const out: Milestones = {
    firstTournament: firstOf(rows, () => true),
    firstBreak: firstOf(rows, broke),
    firstFinal: firstOf(rows, reachedFinal),
    firstTitle: firstOf(rows, title),
    bestSpeech,
    bestSpeakerRank: bestRank(rows, (r) => r.speakerRankOpen),
    bestBreakRank: bestRank(
      rows.filter(broke),
      (r) => r.teamBreakRank,
    ),
    breakRun,
    undated,
    undatedFirsts: {
      tournament: undated,
      break: undatedRows.filter(broke).length,
      final: undatedRows.filter(reachedFinal).length,
      title: undatedRows.filter(title).length,
    },
  };

  // An all-undated record can still hold breaks and titles worth stating as
  // "undated"; only a record with no figure of any kind has nothing to show.
  const { break: b, final: f, title: w } = out.undatedFirsts;
  const empty =
    !out.firstTournament && !out.bestSpeech && !out.bestSpeakerRank && !out.bestBreakRank && !out.breakRun && b + f + w === 0;
  return empty ? null : out;
}
