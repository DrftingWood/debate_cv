import type { PieceRef } from '@/lib/calicotab/scrapePieces';

/**
 * Shared shapes for the data-accuracy audit. Design:
 * docs/superpowers/specs/2026-10-31-data-accuracy-design.md.
 */

export type CheckCode =
  | 'champion'
  | 'rounds_complete'
  | 'rooms_consistent'
  | 'team_coverage'
  | 'partners'
  | 'panels'
  | 'points_add_up'
  | 'outround_shape'
  | 'break_matches'
  | 'break_unstored'
  | 'speaker_tab'
  | 'motions'
  | 'scrape_incomplete'
  | 'parser_stale'
  | 'format_missing'
  | 'core_missing'
  | 'user_reports';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'na';

export type CheckResult = {
  code: CheckCode;
  status: CheckStatus;
  /** One plain sentence with the numbers. */
  detail: string;
  /** Pieces a re-scrape should fetch. `url` is always public (publicPieceUrl). */
  pieces: Array<PieceRef & { label: string; url: string | null }>;
  /**
   * Unsettled rules that decided this result (see ASSUMPTIONS). Absent when
   * the result rests only on rules the owner has agreed.
   */
  assumptions?: AssumptionCode[];
  /**
   * Set when an admin marked this check checked and the mark still matches
   * the finding (lib/admin/adminChecks.ts): the check then counts as a pass,
   * and these say who vouched for it and when (ISO 8601), so the tables can
   * show it.
   */
  checkedBy?: string;
  checkedAt?: string;
  /** What the check said before the mark made it a pass. */
  wasStatus?: 'fail' | 'warn';
};

/**
 * A rule a check relies on that the owner has not settled. Each code is
 * listed in the admin overview's "Open questions" panel with the tournaments
 * it decided, so the owner can see what the choice affects before ruling.
 */
export type AssumptionCode = 'no_open_bracket_champion';

export const ASSUMPTIONS: Record<AssumptionCode, { title: string; rule: string; status: string }> =
  {
    no_open_bracket_champion: {
      title: 'Champion when a tab has no Open bracket',
      rule: 'When a tab has no Open bracket (for example schools Senior/Junior or APDA Varsity/Novice), the bracket with the most outround teams names the champion.',
      status: 'On hold — owner to decide',
    },
  };

/**
 * Weight of each check in the tournament score. user_reports has none: it is
 * a flat penalty applied after the weighted score, not part of it.
 */
export const CHECK_WEIGHTS: Record<Exclude<CheckCode, 'user_reports'>, number> = {
  champion: 15,
  rounds_complete: 15,
  rooms_consistent: 10,
  team_coverage: 10,
  partners: 10,
  panels: 10,
  points_add_up: 10,
  outround_shape: 5,
  break_matches: 5,
  break_unstored: 3,
  speaker_tab: 7,
  motions: 3,
  scrape_incomplete: 10,
  parser_stale: 3,
  format_missing: 3,
  core_missing: 2,
};

export const CHECK_LABELS: Record<CheckCode, string> = {
  champion: 'Champion',
  rounds_complete: 'Rounds complete',
  rooms_consistent: 'Rooms per round',
  team_coverage: 'Teams in rounds',
  partners: 'Partners',
  panels: 'Panels',
  points_add_up: 'Points add up',
  outround_shape: 'Outround shape',
  break_matches: 'Break size',
  break_unstored: 'Break stored',
  speaker_tab: 'Speaker tab',
  motions: 'Motions',
  scrape_incomplete: 'Scrape incomplete',
  parser_stale: 'Old parser',
  format_missing: 'Format',
  core_missing: 'Adjudication core',
  user_reports: 'User reports',
};

/**
 * A piece URL that is safe to show as a link. Stored piece URLs can come from
 * a user's private-URL ingest, and a private key is someone's identity, so a
 * `/privateurls/<key>/` path is replaced by the tournament's public base
 * (scheme + host + first path segment). Any other absolute http(s) URL is
 * returned unchanged; anything unparseable (or another scheme) is null.
 * prescrape's publicTournamentBase is not reused: it throws on private URLs,
 * which is exactly the input this must accept.
 */
export function publicPieceUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
  const parts = parsed.pathname.split('/').filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === 'privateurls')) {
    const slug = parts[0];
    if (!slug || slug.toLowerCase() === 'privateurls') return `${parsed.origin}/`;
    return `${parsed.origin}/${slug}/`;
  }
  return url;
}
