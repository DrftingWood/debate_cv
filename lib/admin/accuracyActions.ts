import type { PieceRef } from '@/lib/calicotab/scrapePieces';

/**
 * The pure half of the accuracy table's "Re-scrape suggested" button, kept
 * out of the component so it can be tested without a DOM, and out of
 * lib/admin/accuracy.ts so the client bundle never imports the database.
 */

/** POST /api/admin/tournaments/[id]/rescrape refuses more pieces than this. */
export const RESCRAPE_PIECE_CAP = 40;

/** A piece a check suggests re-scraping. `url` is public or null. */
export type SuggestedPiece = PieceRef & { label: string; url: string | null };

export type RescrapeAction = {
  body: { pieces: PieceRef[] | 'failed' };
  label: string;
  busyLabel: string;
  /** Accessible name: the visible words, then which row (UX-11). */
  name: (tournamentName: string) => string;
  /** The status line while it runs (UX-22). */
  status: (tournamentName: string) => string;
};

/**
 * What the button sends and says. With suggested pieces it re-scrapes those
 * (only kind and key: the route's schema has no room for labels or links);
 * with none, a check failed without naming a piece, so the next best thing
 * is every piece that failed to load.
 */
export function rescrapeAction(suggested: readonly SuggestedPiece[]): RescrapeAction {
  const pieces = suggested.slice(0, RESCRAPE_PIECE_CAP).map(({ kind, key }) => ({ kind, key }));
  const label =
    pieces.length > 0 ? `Re-scrape suggested (${pieces.length})` : 'Re-scrape all failed';
  return {
    body: { pieces: pieces.length > 0 ? pieces : 'failed' },
    label,
    busyLabel: 'Re-scraping…',
    name: (t) => `${label} for ${t}`,
    status: (t) =>
      pieces.length > 0
        ? `Re-scraping the suggested pages of ${t}. This can take up to a minute.`
        : `Re-scraping the failed pages of ${t}. This can take up to a minute.`,
  };
}
