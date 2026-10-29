import type { CvJudgeRow, CvSpeakerRow } from '@/lib/cv/buildCvData';
import { SPEAKING_TIERS, speakingCell } from '@/lib/cv/careerChart';
import { formatTopPercent, teamTabPlacement } from '@/lib/cv/teamPlacement';

/**
 * The Record page's year groups and their subtotal rows (redesign, owner
 * decisions 13-15, 2026-10-29). Pure, so the page only lays the numbers out.
 *
 * The subtotal is team-focused, because the team's result is what a
 * tournament records: tournaments · broke n of N · best result · median
 * team-tab place (n). Beneath it the user's own speaking (speaker-tab
 * average over n speeches), then a judging line for a year they judged.
 *
 * Each figure reads an existing definition rather than restating one: the
 * best result is the career chart's speaking tier (`speakingCell`), the team
 * place is `teamTabPlacement`, and a judging break is the row's `broke`
 * (owner rule C25, the same count the header's tile uses).
 */

export type SpeakingYearTotal = {
  tournaments: number;
  broke: number;
  /** "Semifinals", "ESL Champion"; null when nothing broke. */
  bestResult: string | null;
  /** Median of the team's top-x% on the prelim team tab, and over how many rows. */
  medianTeamPlace: { label: string; n: number } | null;
  /** Speaker score per prelim speech, weighted by speeches, and their count. */
  speakerAverage: { value: number; speeches: number } | null;
};

export type JudgingYearTotal = {
  tournaments: number;
  /** Tournaments with a judging break (a judged outround or the adjudicator break). */
  outrounds: number;
  /** Tournaments where the user chaired an outround. */
  chaired: number;
  /** Tournaments on the adjudication core (CA, DCA, core). */
  core: number;
};

export type RecordYear = {
  /** Null holds the rows the tab never dated, listed last. */
  year: number | null;
  speaking: CvSpeakerRow[];
  judging: CvJudgeRow[];
  speakingTotal: SpeakingYearTotal | null;
  judgingTotal: JudgingYearTotal | null;
};

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function speakingYearTotal(rows: readonly CvSpeakerRow[]): SpeakingYearTotal | null {
  if (rows.length === 0) return null;
  const cells = rows.map(speakingCell);
  // Highest tier wins; within a tier a major beats a non-major.
  const best = cells
    .filter((c) => c.tier !== 'none')
    .sort(
      (a, b) =>
        SPEAKING_TIERS.indexOf(b.tier) - SPEAKING_TIERS.indexOf(a.tier) ||
        Number(b.major) - Number(a.major),
    )
    .at(0);
  const places = rows
    .map((r) => teamTabPlacement(r.teamRank, r.totalTeams))
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .map((p) => p.topPercent);
  const mid = median(places);
  let points = 0;
  let speeches = 0;
  for (const r of rows) {
    const avg = r.speakerAvgScore == null ? NaN : Number.parseFloat(r.speakerAvgScore);
    if (!Number.isFinite(avg) || r.prelimsSpoken <= 0) continue;
    points += avg * r.prelimsSpoken;
    speeches += r.prelimsSpoken;
  }
  return {
    tournaments: rows.length,
    broke: rows.filter((r) => r.broke).length,
    bestResult: best?.detail ?? null,
    medianTeamPlace:
      mid == null ? null : { label: `top ${formatTopPercent(mid)}`, n: places.length },
    speakerAverage: speeches > 0 ? { value: points / speeches, speeches } : null,
  };
}

export function judgingYearTotal(rows: readonly CvJudgeRow[]): JudgingYearTotal | null {
  if (rows.length === 0) return null;
  return {
    tournaments: rows.length,
    outrounds: rows.filter((r) => r.broke).length,
    chaired: rows.filter((r) => r.lastOutroundChaired != null).length,
    core: rows.filter((r) => r.judgeTypeTag === 'core').length,
  };
}

/** Every year with a row in either role, newest first; undated rows last. */
export function recordYears(
  speakerRows: readonly CvSpeakerRow[],
  judgeRows: readonly CvJudgeRow[],
): RecordYear[] {
  const keys = new Set<number | null>([
    ...speakerRows.map((r) => r.year),
    ...judgeRows.map((r) => r.year),
  ]);
  return [...keys]
    .sort((a, b) => (a == null ? 1 : b == null ? -1 : b - a))
    .map((year) => {
      const speaking = speakerRows.filter((r) => r.year === year);
      const judging = judgeRows.filter((r) => r.year === year);
      return {
        year,
        speaking,
        judging,
        speakingTotal: speakingYearTotal(speaking),
        judgingTotal: judgingYearTotal(judging),
      };
    });
}

/**
 * Which years start open: the current and previous calendar year (owner
 * decision 15). A record whose last tournament is older than that opens its
 * most recent year instead, so the page never lands fully folded.
 */
export function openYears(years: readonly RecordYear[], now: Date): Set<number> {
  const current = now.getUTCFullYear();
  const dated = years.map((y) => y.year).filter((y): y is number => y != null);
  const open = new Set(dated.filter((y) => y === current || y === current - 1));
  if (open.size === 0 && dated.length > 0) open.add(Math.max(...dated));
  return open;
}
