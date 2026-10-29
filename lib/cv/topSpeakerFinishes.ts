import type { CvSpeakerRow } from '@/lib/cv/buildCvData';
import { topSpeakerDetail } from '@/lib/cv/careerChart';
import { isMajor } from '@/lib/cv/majors';

/**
 * Speaking → Speaks → Top-10 finishes on /cv/stats (redesign owner decision
 * 19). The same finishes the speaking chart's stars count (decision 10): Open
 * top 10, or top 10 in an ESL or EFL category, once per tournament.
 * `topSpeakerDetail` is the one definition both read.
 */

export type TopSpeakerFinish = {
  tournamentName: string;
  year: number | null;
  /** "Open #4 · ESL #1". */
  detail: string;
  major: boolean;
};

type Input = Pick<
  CvSpeakerRow,
  'tournamentName' | 'year' | 'speakerRankOpen' | 'speakerRankEsl' | 'speakerRankEfl'
>;

export function topSpeakerFinishes(rows: readonly Input[]): {
  finishes: TopSpeakerFinish[];
  /** Tournaments spoken at, the denominator of the rate. */
  tournaments: number;
} {
  const finishes = rows
    .flatMap((r) => {
      const detail = topSpeakerDetail(r);
      return detail
        ? [
            {
              tournamentName: r.tournamentName,
              year: r.year,
              detail,
              major: isMajor(r.tournamentName),
            },
          ]
        : [];
    })
    // Newest first; within a year, majors first.
    .sort(
      (a, b) =>
        (b.year ?? -Infinity) - (a.year ?? -Infinity) ||
        Number(b.major) - Number(a.major) ||
        a.tournamentName.localeCompare(b.tournamentName),
    );
  return { finishes, tournaments: rows.length };
}
