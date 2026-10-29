import { classifyOutroundStage, outroundRankStrict, tierRank } from '@/lib/calicotab/judgeStats';
import type { CvJudgeRow, CvSpeakerRow } from '@/lib/cv/buildCvData';
import { championTitle, formatStageForDisplay } from '@/lib/cv/formatStage';
import { isMajor } from '@/lib/cv/majors';
import { bracketOf } from '@/lib/cv/outroundFunnel';
import { breakDepth, isTopSpeaker } from '@/lib/cv/teamPlacement';

/**
 * The model behind the two career charts (redesign, owner decisions
 * 2026-10-29): one stacked bar per calendar year, one cell per tournament,
 * ordered by how far the user got. Pure, so the server computes it and the
 * chart component only draws.
 *
 * Every tier reads an existing definition rather than restating one:
 * break depth is `breakDepth` (deepest bracket, gold > silver > bronze), a
 * title is `wonTournament` outside a consolation bracket, a top-10 finish is
 * `isTopSpeaker`, core is `judgeTypeTag === 'core'` and a chaired outround is
 * `lastOutroundChaired`, exactly as the Highlights figures count them.
 *
 * Owner rules applied here:
 *   - Gold, Silver and Bronze finals all count as finals; only winning a
 *     gold final (or an untiered Open or category final) is a champion.
 *     Winning a silver or bronze final stays in the finals tier, with the
 *     win in its label.
 *   - Category breaks (ESL, EFL, Novice) count at their stage; a category
 *     final win is a champion. Partial quarterfinals are quarterfinals
 *     (the stage ranks already encode that).
 *   - A top-10 speaker finish is Open top 10 or top 10 in an ESL / EFL
 *     category, counted once per tournament.
 *   - Core (CA, DCA, adj core) is its own judging tier, counted once and
 *     not also as the outround judged.
 */

/** Bottom to top. `none` sits below the ink rule; the rest are breaks. */
export const SPEAKING_TIERS = ['none', 'qf', 'sf', 'f', 'champion'] as const;
export type SpeakingTier = (typeof SPEAKING_TIERS)[number];

/** Bottom to top. `chairedFinal` is judging's champion tier; `core` is purple. */
export const JUDGING_TIERS = ['none', 'qf', 'sf', 'f', 'chairedFinal', 'core'] as const;
export type JudgingTier = (typeof JUDGING_TIERS)[number];

export type CareerCell<T extends string> = {
  tournamentName: string;
  tier: T;
  major: boolean;
  /** What happened, for the details panel: "Semifinals", "ESL Champion". */
  detail: string;
};

export type CareerYear<T extends string> = {
  year: number;
  /** Bottom to top: by tier, then majors first within a tier. */
  cells: CareerCell<T>[];
  /** Speaking: top-10 speaker finishes. Judging: tournaments with an outround chaired. */
  stars: { tournamentName: string; detail: string }[];
};

export type CareerSeries<T extends string> = {
  /** Every calendar year from the first to the last, gaps included. */
  years: CareerYear<T>[];
  /** Rows with no year: counted, never placed on the timeline. */
  undated: number;
};

// Canonical stage ranks (JUDGE_STATS_RANK in judgeStats.ts): final and grand
// final 95, semifinal 90, partial semifinal 85, everything earlier below.
const FINAL_RANK = 95;
const SEMI_RANK = 85;

function stageTier(rank: number): 'qf' | 'sf' | 'f' {
  if (rank >= FINAL_RANK) return 'f';
  if (rank >= SEMI_RANK) return 'sf';
  return 'qf';
}

type SpeakingRow = Pick<
  CvSpeakerRow,
  | 'tournamentName'
  | 'year'
  | 'broke'
  | 'eliminationReached'
  | 'eliminationReachedByCategory'
  | 'wonTournament'
  | 'speakerRankOpen'
  | 'speakerRankEsl'
  | 'speakerRankEfl'
>;

export function speakingCell(row: SpeakingRow): CareerCell<SpeakingTier> {
  const major = isMajor(row.tournamentName);
  const depth = breakDepth(row);
  // A Plate or Consolation run is the bracket for teams that missed the
  // break, so it is not a break (the same exclusion championshipHighlights
  // makes).
  if (depth && bracketOf(depth.stage) === 'consolation') {
    return { tournamentName: row.tournamentName, tier: 'none', major, detail: 'Did not break' };
  }
  if (!depth) {
    // Broke, but the outround draw was never published: a break of unknown
    // depth sits in the lowest break tier rather than vanishing.
    return row.broke
      ? { tournamentName: row.tournamentName, tier: 'qf', major, detail: 'Broke' }
      : { tournamentName: row.tournamentName, tier: 'none', major, detail: 'Did not break' };
  }
  const stage = formatStageForDisplay(depth.stage) || 'Broke';
  // tierRank: Gold 3, Silver 2, Bronze 1, untiered 0.
  const tiered = tierRank(depth.stage);
  if (row.wonTournament === true) {
    if (tiered === 1 || tiered === 2) {
      return { tournamentName: row.tournamentName, tier: 'f', major, detail: `Won the ${stage}` };
    }
    return {
      tournamentName: row.tournamentName,
      tier: 'champion',
      major,
      detail: championTitle(depth.stage),
    };
  }
  return { tournamentName: row.tournamentName, tier: stageTier(depth.rank), major, detail: stage };
}

/** Open top 10, or top 10 in an ESL / EFL category; null when neither. */
export function topSpeakerDetail(
  row: Pick<CvSpeakerRow, 'speakerRankOpen' | 'speakerRankEsl' | 'speakerRankEfl'>,
): string | null {
  const parts = [
    isTopSpeaker(row.speakerRankOpen) ? `Open #${row.speakerRankOpen}` : null,
    isTopSpeaker(row.speakerRankEsl) ? `ESL #${row.speakerRankEsl}` : null,
    isTopSpeaker(row.speakerRankEfl) ? `EFL #${row.speakerRankEfl}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}

type JudgingRow = Pick<
  CvJudgeRow,
  | 'tournamentName'
  | 'year'
  | 'judgeTypeTag'
  | 'judgedOutroundStages'
  | 'lastOutroundJudged'
  | 'lastOutroundChaired'
>;

function isOpenOrCategoryFinal(label: string | null): boolean {
  return (
    !!label && bracketOf(label) !== 'consolation' && (outroundRankStrict(label) ?? 0) >= FINAL_RANK
  );
}

export function judgingCell(row: JudgingRow): CareerCell<JudgingTier> {
  const major = isMajor(row.tournamentName);
  const base = { tournamentName: row.tournamentName, major };
  if (row.judgeTypeTag === 'core') return { ...base, tier: 'core', detail: 'Adjudication core' };
  if (isOpenOrCategoryFinal(row.lastOutroundChaired)) {
    return {
      ...base,
      tier: 'chairedFinal',
      detail: `Chaired the ${formatStageForDisplay(row.lastOutroundChaired)}`,
    };
  }
  // A chaired outround is a judged one: a row that carries only the chair
  // (no "last outround judged") still placed the user in that outround.
  const judged = [
    ...row.judgedOutroundStages,
    ...(row.lastOutroundJudged ? [row.lastOutroundJudged] : []),
    ...(row.lastOutroundChaired ? [row.lastOutroundChaired] : []),
  ]
    .filter((label) => bracketOf(label) !== 'consolation' && classifyOutroundStage(label) !== null)
    .map((label) => ({ label, rank: outroundRankStrict(label) ?? 0 }))
    .sort((a, b) => b.rank - a.rank);
  const deepest = judged.at(0);
  if (!deepest) return { ...base, tier: 'none', detail: 'No outround' };
  return {
    ...base,
    tier: stageTier(deepest.rank),
    detail: `Judged the ${formatStageForDisplay(deepest.label)}`,
  };
}

function byTierThenMajor<T extends string>(order: readonly T[]) {
  return (a: CareerCell<T>, b: CareerCell<T>) =>
    order.indexOf(a.tier) - order.indexOf(b.tier) ||
    Number(b.major) - Number(a.major) ||
    a.tournamentName.localeCompare(b.tournamentName);
}

function series<R extends { year: number | null; tournamentName: string }, T extends string>(
  rows: R[],
  how: {
    order: readonly T[];
    cell: (row: R) => CareerCell<T>;
    star: (row: R) => string | null;
  },
): CareerSeries<T> {
  const { order, cell, star } = how;
  const dated = rows.filter((r): r is R & { year: number } => r.year != null);
  const undated = rows.length - dated.length;
  if (dated.length === 0) return { years: [], undated };
  const first = Math.min(...dated.map((r) => r.year));
  const last = Math.max(...dated.map((r) => r.year));
  const years: CareerYear<T>[] = [];
  for (let year = first; year <= last; year++) {
    const inYear = dated.filter((r) => r.year === year);
    years.push({
      year,
      cells: inYear.map(cell).sort(byTierThenMajor(order)),
      stars: inYear.flatMap((r) => {
        const detail = star(r);
        return detail ? [{ tournamentName: r.tournamentName, detail }] : [];
      }),
    });
  }
  return { years, undated };
}

export function speakingSeries(rows: SpeakingRow[]): CareerSeries<SpeakingTier> {
  return series(rows, { order: SPEAKING_TIERS, cell: speakingCell, star: topSpeakerDetail });
}

export function judgingSeries(rows: JudgingRow[]): CareerSeries<JudgingTier> {
  return series(rows, {
    order: JUDGING_TIERS,
    cell: judgingCell,
    star: (r) =>
      r.lastOutroundChaired ? `Chaired the ${formatStageForDisplay(r.lastOutroundChaired)}` : null,
  });
}
