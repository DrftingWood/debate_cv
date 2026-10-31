import { splitStageLabel } from '@/lib/calicotab/stageLexicon';
import type { CvSpeakerRow } from '@/lib/cv/buildCvData';
import { breakDepth } from '@/lib/cv/teamPlacement';
import { isTierBracket } from '@/lib/cv/outroundFunnel';

/**
 * The speaking career chart's category filter (owner, 2026-10-31): the chart
 * can show only the Open results, only ESL, EFL, Novice / Pro-Am, or the
 * rest. Only that chart reads it: the ledger, the tiles, the statistics and
 * the judging chart stay as they are.
 *
 * Five categories, fixed by the owner:
 *   open    the Open bracket, and the Gold / Silver / Bronze tier brackets
 *           (one field split into tiers, so they are Open)
 *   esl     ESL
 *   efl     EFL
 *   novice  Novice and Pro-Am
 *   other   any other bracket (Senior, Junior, Varsity, Schools, ...)
 *
 * A Plate / Consolation bracket is for teams that missed the break, so it
 * belongs to none of them (the chart already treats it as "did not break").
 */
export const CV_CATEGORIES = ['open', 'esl', 'efl', 'novice', 'other'] as const;
export type CvCategory = (typeof CV_CATEGORIES)[number];

export const CV_CATEGORY_LABELS: Record<CvCategory, string> = {
  open: 'Open',
  esl: 'ESL',
  efl: 'EFL',
  novice: 'Novice / Pro-Am',
  other: 'Others',
};

export function readCvCategory(value: string | string[] | undefined): CvCategory | null {
  const v = Array.isArray(value) ? value[0] : value;
  return (CV_CATEGORIES as readonly string[]).includes(v ?? '') ? (v as CvCategory) : null;
}

const CONSOLATION = /plate|consolation|wooden|spoon/i;

/** The category of an outround stage label; null for a consolation bracket. */
export function categoryOfLabel(label: string | null | undefined): CvCategory | null {
  const { category } = splitStageLabel(label);
  const c = category?.trim() ?? '';
  if (c === '' || /^open$/i.test(c) || isTierBracket(label)) return 'open';
  if (CONSOLATION.test(c)) return null;
  if (/^esl$/i.test(c)) return 'esl';
  if (/^efl$/i.test(c)) return 'efl';
  if (/novice|pro-?am/i.test(c)) return 'novice';
  return 'other';
}

type FilterRow = Pick<
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

/** Only this category's outround labels, in the shape breakDepth reads. */
function keepStages(row: FilterRow, cat: CvCategory) {
  const byCategory = row.eliminationReachedByCategory?.filter(
    (e) => categoryOfLabel(e.stage) === cat,
  );
  return {
    eliminationReached:
      row.eliminationReached && categoryOfLabel(row.eliminationReached) === cat
        ? row.eliminationReached
        : null,
    eliminationReachedByCategory: byCategory && byCategory.length > 0 ? byCategory : null,
  };
}

/** Whether the speaker tab ranked the user in this category. */
function rankedIn(row: FilterRow, cat: CvCategory): boolean {
  const rank = { open: row.speakerRankOpen, esl: row.speakerRankEsl, efl: row.speakerRankEfl }[
    cat as 'open' | 'esl' | 'efl'
  ];
  return rank != null;
}

/**
 * What one tournament looks like in one category, or null when the user has
 * nothing there. Open keeps every tournament (a team that did not break
 * still played the Open draw); the other four keep only tournaments with an
 * outround or a ranked speaker finish in that category.
 *
 * A title is the row's `wonTournament` flag, which belongs to the deepest
 * bracket overall, so it carries over only when that bracket is this one.
 */
export function rowForCategory<R extends FilterRow>(row: R, cat: CvCategory): R | null {
  const kept = keepStages(row, cat);
  const here = breakDepth(kept);
  if (cat !== 'open' && !here && !rankedIn(row, cat)) return null;
  const overall = breakDepth(row);
  return {
    ...row,
    ...kept,
    // A break of unknown depth (no outround draw published) is an Open break.
    broke: here != null || (cat === 'open' && overall == null && row.broke),
    wonTournament: row.wonTournament === true && here != null && here.stage === overall?.stage,
    speakerRankOpen: cat === 'open' ? row.speakerRankOpen : null,
    speakerRankEsl: cat === 'esl' ? row.speakerRankEsl : null,
    speakerRankEfl: cat === 'efl' ? row.speakerRankEfl : null,
  };
}

/** The rows of one category, for the chart; every row when no category is chosen. */
export function rowsForCategory<R extends FilterRow>(rows: R[], cat: CvCategory | null): R[] {
  if (cat == null) return rows;
  return rows.flatMap((r) => {
    const out = rowForCategory(r, cat);
    return out ? [out] : [];
  });
}

/** How many tournaments each category has, so the filter lists only the ones with data. */
export function categoryCounts(rows: FilterRow[]): Record<CvCategory, number> {
  const out = Object.fromEntries(CV_CATEGORIES.map((c) => [c, 0])) as Record<CvCategory, number>;
  for (const c of CV_CATEGORIES) out[c] = rowsForCategory(rows, c).length;
  return out;
}
