import { suggestedPieces, type ParsedCheck } from '@/lib/admin/accuracy';
import type { FixAction } from '@/lib/admin/inboxTypes';

/**
 * What "Fix" does for a tournament's open check findings. When the only thing
 * open is the missing format, the fix is "Infer format": it reads the stored
 * rounds and team sizes, so it needs no fetch, and the pieces ride along for
 * the case it cannot decide (the button then offers a re-scrape of exactly
 * those, R1 and the team tab). When the only thing open is the old-parser
 * finding, the fix is the very refresh the Tools tab runs (every recorded
 * page, then the refresh is recorded), so the two behave identically. With
 * anything else open, the re-scrape of the
 * pages the findings name is the fix, and it redoes the format on the way.
 */
export function checkFix(tournamentId: string, open: readonly ParsedCheck[]): FixAction {
  const pieces = suggestedPieces([...open]);
  if (open.length > 0 && open.every((c) => c.code === 'format_missing')) {
    return { type: 'infer_format', tournamentId, pieces };
  }
  if (open.length > 0 && open.every((c) => c.code === 'parser_stale')) {
    return { type: 'refresh_old', tournamentId };
  }
  return { type: 'rescrape', tournamentId, pieces };
}
