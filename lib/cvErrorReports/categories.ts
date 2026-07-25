/**
 * Single source of truth for the closed list of CV-error-report
 * categories. Used by:
 *   - the report modal (CvRowReportButton) to render checkboxes
 *   - the POST /api/cv/error-report Zod validator
 *   - /settings/reports (user's own report history)
 *   - /admin (CV reports inbox + CSV export)
 *
 * Codes are the storage key — they go into `CvErrorReport.categories`
 * verbatim. Long-form labels are what the report modal shows; short
 * labels are what the admin queue / settings page / CSV use so each row
 * fits in a compact badge.
 */
export const REPORT_CATEGORIES = [
  'wrong_teammate',
  'wrong_speaker_rank',
  'wrong_speaker_average',
  'wrong_team_result',
  'wrong_outround',
  'wrong_identity',
  'claimed_by_someone_else',
  'other',
] as const;

export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<ReportCategory, string> = {
  wrong_teammate: 'Wrong teammate',
  wrong_speaker_rank: 'Wrong speaker rank',
  wrong_speaker_average: 'Wrong speaker average',
  wrong_team_result: 'Wrong team result',
  wrong_outround: 'Wrong outround',
  wrong_identity: "Didn't speak/judge here",
  claimed_by_someone_else: 'Someone claimed my identity',
  other: 'Other',
};

/**
 * Long-form labels shown on the report modal. Spelled out so the user
 * understands exactly what each category covers; the short labels above
 * are derived from these for the dense admin / settings views.
 */
export const CATEGORY_LONG_LABELS: Record<ReportCategory, string> = {
  wrong_teammate: 'Wrong teammate / teammate missing',
  wrong_speaker_rank: 'Wrong speaker rank / rank missing',
  wrong_speaker_average: 'Wrong speaker average / average missing',
  wrong_team_result: 'Wrong team result (rank, points, win/loss)',
  wrong_outround: 'Wrong outround / Champion marker',
  wrong_identity: "I didn't speak/judge at this tournament",
  claimed_by_someone_else:
    'My results at this tournament are on someone else\u2019s account',
  other: 'Other (describe in comment)',
};

/** Render a category code as its short human label, with a fallback. */
export function categoryLabel(code: string): string {
  return (CATEGORY_LABELS as Record<string, string>)[code] ?? code;
}
