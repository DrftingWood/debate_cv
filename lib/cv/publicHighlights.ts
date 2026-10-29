import type { CvJudgeRow, CvSpeakerRow } from '@/lib/cv/buildCvData';
import {
  JUDGING_TIERS,
  SPEAKING_TIERS,
  judgingCell,
  speakingCell,
  type CareerCell,
} from '@/lib/cv/careerChart';

/**
 * The public CV's Highlights (redesign owner decision 18, 2026-10-29): two
 * short lists side by side, Speaking and Judging, up to three each, majors
 * first. Every entry is a result the career chart already places, so the
 * ranking reads the chart's own tiers (`speakingCell` / `judgingCell`):
 * within the majors and then within the rest, the deeper tier first, then
 * the more recent year. A tournament with no break (speaking) or no outround
 * (judging) is never a highlight.
 */

export type Highlight = {
  tournamentName: string;
  year: number | null;
  /** "Semifinals", "ESL Champion", "Chaired the Grand Final". */
  detail: string;
  major: boolean;
};

const HIGHLIGHTS_PER_LIST = 3;

function pick<R extends { year: number | null }, T extends string>(
  rows: readonly R[],
  cell: (row: R) => CareerCell<T>,
  order: readonly T[],
): Highlight[] {
  return rows
    .map((r) => ({ r, c: cell(r) }))
    .filter(({ c }) => c.tier !== 'none')
    .sort(
      (a, b) =>
        Number(b.c.major) - Number(a.c.major) ||
        order.indexOf(b.c.tier) - order.indexOf(a.c.tier) ||
        (b.r.year ?? -Infinity) - (a.r.year ?? -Infinity),
    )
    .slice(0, HIGHLIGHTS_PER_LIST)
    .map(({ r, c }) => ({
      tournamentName: c.tournamentName,
      year: r.year,
      detail: c.detail,
      major: c.major,
    }));
}

export function publicHighlights(
  speakerRows: readonly CvSpeakerRow[],
  judgeRows: readonly CvJudgeRow[],
): { speaking: Highlight[]; judging: Highlight[] } {
  return {
    speaking: pick(speakerRows, speakingCell, SPEAKING_TIERS),
    judging: pick(judgeRows, judgingCell, JUDGING_TIERS),
  };
}
