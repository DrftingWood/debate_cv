import { outroundRankStrict, tierRank } from '@/lib/calicotab/judgeStats';
import { splitOutroundStage } from '@/lib/calicotab/breakCategoryResolve';
import { bracketOf } from '@/lib/cv/outroundFunnel';
import { titleCategory } from '@/lib/cv/formatStage';
import { rankLabel } from '@/lib/cv/rankDisplay';
import type { CvHighlights, CvSpeakerRow } from '@/lib/cv/buildCvData';

/**
 * How high a team placed, and how far it went — the two questions the CV
 * answers about a tournament result.
 *
 * Owner rule (2026-10): placement is judged by the TEAM, not the speaker.
 * Debate breaks teams, so "did I finish in the top 10%?" means "did my team
 * finish in the top 10% of the team tab", and "how strong was that break?"
 * means "how far did the team get in the outrounds". The speaker tab is a
 * separate, individual statistic: it stays on the CV, but it is labelled as
 * the speaker tab and never stands in for either answer.
 *
 * The previous highlight compared a speaker-tab rank with the number of
 * TEAMS (`speakerRankOpen <= ceil(totalTeams * 0.10)`), a unit mismatch that
 * roughly halved the bar in two-speaker formats. Everything here compares a
 * team rank with a team count.
 *
 * Pure, so the CV highlights, the header strip, the statistics page and the
 * exports all read one definition.
 */

export type TeamTabPlacement = {
  /** 1-based prelim team-tab rank. */
  rank: number;
  /** Teams on the tab. */
  of: number;
  /**
   * 0..100 — share of the other teams this team finished above. Rank 1 of 40
   * is 97.5, rank 40 of 40 is 0.
   */
  percentile: number;
  /**
   * The "top N%" a reader means: rank / teams. Rank 1 of 40 is the top 2.5%,
   * rank 4 of 40 the top 10%. Always 100 − percentile.
   */
  topPercent: number;
};

/**
 * The team's prelim placement against the whole team tab, or null when the
 * rank or field size is missing or the two are inconsistent (a rank past the
 * team count means one of them is from a different tab, and quoting a
 * percentage off it would be invented precision).
 */
export function teamTabPlacement(
  teamRank: number | null | undefined,
  totalTeams: number | null | undefined,
): TeamTabPlacement | null {
  if (teamRank == null || totalTeams == null) return null;
  if (!Number.isInteger(teamRank) || !Number.isInteger(totalTeams)) return null;
  if (teamRank < 1 || totalTeams < 1 || teamRank > totalTeams) return null;
  return {
    rank: teamRank,
    of: totalTeams,
    percentile: ((totalTeams - teamRank) / totalTeams) * 100,
    topPercent: (teamRank / totalTeams) * 100,
  };
}

/**
 * The "Top 10 speaker" bar: an ABSOLUTE speaker-tab rank, not a percentile.
 * Owner decision (assumptions C3, Q5) — the earlier "top 10% of the team
 * tab" rule, with its ceil rounding, is gone. Rank 10 qualifies at any field
 * size; rank 11 never does.
 */
export const TOP_SPEAKER_RANK = 10;

export function isTopSpeaker(rank: number | null | undefined): boolean {
  return rank != null && Number.isInteger(rank) && rank >= 1 && rank <= TOP_SPEAKER_RANK;
}

export type BreakDepth = {
  /** The stage label as stored ("Semifinals", "ESL Grand Final"). */
  stage: string;
  /**
   * Position on the canonical outround scale (lib/calicotab/judgeStats.ts,
   * JUDGE_STATS_RANK: final / grand final 95 … partial triple octos 45). 0 when the
   * label is an outround the classifier doesn't recognise — still a break,
   * just not one that can be placed on the ladder.
   */
  rank: number;
  /** True when the stage belongs to a category bracket (ESL, Novice, …). */
  category: boolean;
  /** Gold 3 / Silver 2 / Bronze 1 / other 0 — orders tiered finals at equal depth. */
  tier: number;
};

/**
 * The furthest outround the team reached, across every bracket it broke in.
 * Null when the row carries no outround stage at all (did not break, or broke
 * but the outround draw was never published).
 */
export function breakDepth(
  row: Pick<CvSpeakerRow, 'eliminationReached' | 'eliminationReachedByCategory'>,
): BreakDepth | null {
  const labels: { stage: string; category: string | null }[] = [
    ...(row.eliminationReached
      ? [
          {
            stage: row.eliminationReached,
            category: splitOutroundStage(row.eliminationReached).category,
          },
        ]
      : []),
    ...(row.eliminationReachedByCategory ?? []).map((e) => ({
      stage: e.stage,
      category: e.category,
    })),
  ];
  let best: BreakDepth | null = null;
  for (const { stage, category } of labels) {
    const rank = outroundRankStrict(stage) ?? 0;
    const isCategory = !!category && category !== 'Open';
    const tier = tierRank(stage);
    // Deeper wins; at equal depth the Open bracket outranks a category one,
    // and among tiered finals Gold > Silver > Bronze.
    if (
      !best ||
      rank > best.rank ||
      (rank === best.rank && best.category && !isCategory) ||
      (rank === best.rank && best.category === isCategory && tier > best.tier)
    ) {
      best = { stage, rank, category: isCategory, tier };
    }
  }
  return best;
}

/**
 * Break rank against the number of breaking teams, when the Open break tab
 * says how many broke and the user's team is on it. `teamBreakRank` prefers
 * the Open break's rank (resolveTeamBreaks), so the denominator is only
 * quoted when it is the Open break's own count.
 */
export function breakSeed(
  row: Pick<CvSpeakerRow, 'teamBreakRank' | 'openBreak'>,
): { rank: number; of: number | null } | null {
  if (row.teamBreakRank == null || row.teamBreakRank < 1) return null;
  const of =
    row.openBreak?.userOnBreak && row.openBreak.teams >= row.teamBreakRank
      ? row.openBreak.teams
      : null;
  return { rank: row.teamBreakRank, of };
}

type StrengthRow = Pick<
  CvSpeakerRow,
  | 'eliminationReached'
  | 'eliminationReachedByCategory'
  | 'wonTournament'
  | 'teamBreakRank'
  | 'teamRank'
  | 'totalTeams'
>;

/**
 * Sort comparator for break strength, strongest first. In order:
 *   1. furthest outround reached (the owner's rule — depth, not speaker rank);
 *   2. at equal depth, an Open-bracket run before a category one;
 *   3. won that outround (a title beats a grand-final loss);
 *   4. better break seed;
 *   5. better team-tab placement, as a share of the field.
 * Rows with no outround stage sort after every row that has one.
 */
export function compareBreakStrength(a: StrengthRow, b: StrengthRow): number {
  const da = breakDepth(a);
  const db = breakDepth(b);
  if (da && !db) return -1;
  if (!da && db) return 1;
  if (da && db) {
    if (da.rank !== db.rank) return db.rank - da.rank;
    if (da.category !== db.category) return da.category ? 1 : -1;
    if (da.tier !== db.tier) return db.tier - da.tier;
  }
  const wa = a.wonTournament === true ? 1 : 0;
  const wb = b.wonTournament === true ? 1 : 0;
  if (wa !== wb) return wb - wa;
  const ba = a.teamBreakRank ?? Infinity;
  const bb = b.teamBreakRank ?? Infinity;
  if (ba !== bb) return ba - bb;
  const pa = teamTabPlacement(a.teamRank, a.totalTeams)?.topPercent ?? Infinity;
  const pb = teamTabPlacement(b.teamRank, b.totalTeams)?.topPercent ?? Infinity;
  if (pa !== pb) return pa - pb;
  return 0;
}

/**
 * The placement half of the /cv highlights, from the speaker rows alone.
 * Lives here rather than inline in buildCvData so it can be tested without a
 * database.
 */
export function placementHighlights(
  rows: CvSpeakerRow[],
): Pick<CvHighlights, 'deepestBreaks' | 'topSpeakerFinishes' | 'bestTeamFinish'> {
  const deepestBreaks = rows
    .filter((r) => r.broke)
    .sort(compareBreakStrength)
    .slice(0, 5)
    .map((r) => ({
      tournamentName: r.tournamentName,
      year: r.year,
      stage: breakDepth(r)?.stage ?? null,
      won: r.wonTournament === true,
      breakRank: r.teamBreakRank,
    }));

  const placed = rows
    .map((r) => ({ r, p: teamTabPlacement(r.teamRank, r.totalTeams) }))
    .filter((x): x is { r: CvSpeakerRow; p: TeamTabPlacement } => x.p != null)
    // Best share of the field first; at an equal share the bigger field is
    // the harder finish.
    .sort((a, b) => a.p.topPercent - b.p.topPercent || b.p.of - a.p.of);

  // Best (lowest) speaker rank first; Array.sort is stable, so equal ranks keep
  // row order.
  const topSpeakerFinishes = rows
    .filter((r) => isTopSpeaker(r.speakerRankOpen))
    .sort((a, b) => (a.speakerRankOpen as number) - (b.speakerRankOpen as number))
    .slice(0, 5)
    .map((r) => ({
      tournamentName: r.tournamentName,
      year: r.year,
      rank: r.speakerRankOpen as number,
      totalTeams: r.totalTeams ?? null,
    }));

  const best = placed[0];
  const bestTeamFinish = best
    ? {
        tournamentName: best.r.tournamentName,
        year: best.r.year,
        rank: best.p.rank,
        totalTeams: best.p.of,
        topPercent: best.p.topPercent,
        tied: best.r.teamRankTied === true,
      }
    : null;

  return { deepestBreaks, topSpeakerFinishes, bestTeamFinish };
}

/**
 * Best Open speaker-tab rank (owner decision C16): the smallest RAW rank, with
 * the field size and the share-of-field percentile alongside. At an equal rank
 * the bigger field is the better finish. The field size is null when the tab's
 * speaker count was not loaded or contradicts the rank.
 */
export function bestSpeakerRankHighlight(rows: CvSpeakerRow[]): CvHighlights['bestSpeakerRank'] {
  let best: { r: CvSpeakerRow; rank: number; field: number } | null = null;
  for (const r of rows) {
    const rank = r.speakerRankOpen;
    if (rank == null) continue;
    const field = teamTabPlacement(rank, r.speakerFieldSize)?.of ?? 0;
    if (!best || rank < best.rank || (rank === best.rank && field > best.field)) {
      best = { r, rank, field };
    }
  }
  if (!best) return null;
  const p = teamTabPlacement(best.rank, best.r.speakerFieldSize);
  return {
    tournamentName: best.r.tournamentName,
    year: best.r.year,
    rank: best.rank,
    totalSpeakers: p?.of ?? null,
    topPercent: p?.topPercent ?? null,
    tied: best.r.speakerRankTied === true,
  };
}

/** "3 of 40 teams · top 8%" — the one wording every surface uses. */
export function formatTeamTabPlacement(p: TeamTabPlacement, tied = false): string {
  return `${rankLabel(p.rank, tied)} of ${p.of} teams · top ${formatTopPercent(p.topPercent)}`;
}

/** Whole percent, except under 1% where "top 0%" would be false. */
export function formatTopPercent(topPercent: number): string {
  if (topPercent < 1) return '<1%';
  return `${Math.round(topPercent)}%`;
}

/**
 * Titles for the highlights tile. A Plate or Consolation win is a real result
 * but not a championship (milestones already exclude it), so it is left out.
 */
export function championshipHighlights(
  rows: Array<
    Pick<CvSpeakerRow, 'wonTournament' | 'eliminationReached' | 'tournamentName' | 'year'>
  >,
): CvHighlights['championships'] {
  return rows
    .filter((r) => r.wonTournament === true && bracketOf(r.eliminationReached) !== 'consolation')
    .map((r) => {
      const category = titleCategory(r.eliminationReached);
      return { tournamentName: r.tournamentName, year: r.year, ...(category ? { category } : {}) };
    })
    .slice(0, 5);
}
