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
  | 'speaker_tab'
  | 'motions'
  | 'scrape_incomplete'
  | 'parser_stale'
  | 'user_reports';

export type CheckStatus = 'pass' | 'warn' | 'fail' | 'na';

export type CheckResult = {
  code: CheckCode;
  status: CheckStatus;
  /** One plain sentence with the numbers. */
  detail: string;
  /** Pieces a re-scrape should fetch. `url` is always public (publicPieceUrl). */
  pieces: Array<PieceRef & { label: string; url: string | null }>;
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
  speaker_tab: 7,
  motions: 3,
  scrape_incomplete: 10,
  parser_stale: 3,
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
  speaker_tab: 'Speaker tab',
  motions: 'Motions',
  scrape_incomplete: 'Scrape incomplete',
  parser_stale: 'Old parser',
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
