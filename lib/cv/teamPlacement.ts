import { outroundRankStrict, tierRank } from '@/lib/calicotab/judgeStats';
import { splitOutroundStage } from '@/lib/calicotab/breakCategoryResolve';
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
 * True when the team finished inside the top `share` of the team tab
 * (0.1 = top 10%). Uses ceil so a 15-team tab still has a top-10% place
 * (rank 1 or 2) rather than none.
 */
export function inTopShareOfTeamTab(
  teamRank: number | null | undefined,
  totalTeams: number | null | undefined,
  share = 0.1,
): boolean {
  const p = teamTabPlacement(teamRank, totalTeams);
  if (!p) return false;
  return p.rank <= Math.ceil(p.of * share);
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
      ? [{ stage: row.eliminationReached, category: splitOutroundStage(row.eliminationReached).category }]
      : []),
    ...(row.eliminationReachedByCategory ?? []).map((e) => ({ stage: e.stage, category: e.category })),
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
): Pick<CvHighlights, 'deepestBreaks' | 'topTeamFinishes' | 'bestTeamFinish'> {
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

  const topTeamFinishes = placed
    .filter(({ p }) => inTopShareOfTeamTab(p.rank, p.of, 0.1))
    .slice(0, 5)
    .map(({ r, p }) => ({ tournamentName: r.tournamentName, year: r.year, rank: p.rank, totalTeams: p.of }));

  const best = placed[0];
  const bestTeamFinish = best
    ? {
        tournamentName: best.r.tournamentName,
        year: best.r.year,
        rank: best.p.rank,
        totalTeams: best.p.of,
        topPercent: best.p.topPercent,
      }
    : null;

  return { deepestBreaks, topTeamFinishes, bestTeamFinish };
}

/** "3 of 40 teams · top 8%" — the one wording every surface uses. */
export function formatTeamTabPlacement(p: TeamTabPlacement): string {
  return `${p.rank} of ${p.of} teams · top ${formatTopPercent(p.topPercent)}`;
}

/** Whole percent, except under 1% where "top 0%" would be false. */
export function formatTopPercent(topPercent: number): string {
  if (topPercent < 1) return '<1%';
  return `${Math.round(topPercent)}%`;
}
