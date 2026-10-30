import { prisma } from '@/lib/db';

/**
 * How much of a tournament's tab is in the database, for the "Tab" column
 * (owner, 2026-10-31: "tick if fully loaded in tab, ? if partially load
 * (hover to see the errors) and X if not loaded"). Shared by the Failed
 * imports table and the review set now, and by the CV reports and parser
 * warnings tables in Task 5d.
 *
 *   - `missing`: the tournament is not stored at all;
 *   - `partial`: it is stored, but some tab or round page failed to load
 *     (a ScrapePiece with status 'failed'; 'withheld' pages are the
 *     tournament's choice and do not count);
 *   - `loaded`: stored, and nothing failed.
 *
 * `errors` is what the "?" reveals: one line per failed page, in words. The
 * piece's `lastError` is a scraper exception that can carry the page's
 * stored URL, which may be a private one, so it never appears as written:
 * the HTTP status is shown with its reason phrase, and anything else is
 * reduced to a few words (UX-23).
 */

export type TabState = {
  state: 'loaded' | 'partial' | 'missing';
  tournamentId: string | null;
  errors: string[];
};

/** Lines in `errors`; past this the last line counts the rest. */
export const MAX_TAB_ERRORS = 10;

export type FailedPieceLike = {
  label: string;
  httpStatus: number | null;
  lastError: string | null;
};

/** RFC 9110 reason phrases for the statuses a tab site actually answers with. */
const REASON: Record<number, string> = {
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  408: 'Request Timeout',
  410: 'Gone',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
  502: 'Bad Gateway',
  503: 'Service Unavailable',
  504: 'Gateway Timeout',
};

/** A few words for a failure that has no HTTP status (a timeout, a parse error). */
function shortWords(lastError: string | null): string {
  const text = (lastError ?? '').toLowerCase();
  if (!text) return 'did not load';
  if (/timed? ?out|timeout|deadline|aborted/.test(text)) return 'timed out';
  if (/econnreset|socket hang up|fetch failed|enotfound|eai_again|network/.test(text))
    return 'connection failed';
  if (/redirect/.test(text)) return 'redirected away';
  if (/parse|unexpected|cannot read|undefined|selector/.test(text)) return 'page could not be read';
  return 'did not load';
}

/** "R3: HTTP 503 Service Unavailable", or "Speaker tab: timed out". */
export function pieceErrorText(p: FailedPieceLike): string {
  if (p.httpStatus != null) {
    const reason = REASON[p.httpStatus];
    return `${p.label}: HTTP ${p.httpStatus}${reason ? ` ${reason}` : ''}`;
  }
  return `${p.label}: ${shortWords(p.lastError)}`;
}

/** The Tab state of one row, from its stored tournament (or null) and that tournament's failed pages. */
export function tabState(tournamentId: string | null, failed: FailedPieceLike[]): TabState {
  if (!tournamentId) return { state: 'missing', tournamentId: null, errors: [] };
  if (failed.length === 0) return { state: 'loaded', tournamentId, errors: [] };
  const lines = failed.map(pieceErrorText);
  const errors =
    lines.length <= MAX_TAB_ERRORS
      ? lines
      : [
          ...lines.slice(0, MAX_TAB_ERRORS - 1),
          `and ${lines.length - (MAX_TAB_ERRORS - 1)} more pages`,
        ];
  return { state: 'partial', tournamentId, errors };
}

/**
 * The Tab state of each stored tournament, keyed by id, in one query
 * however many rows share a tournament. A row whose tournament is not
 * stored is not asked about here: it is `tabState(null, [])`.
 */
export async function loadTabStates(tournamentIds: string[]): Promise<Map<string, TabState>> {
  const ids = [...new Set(tournamentIds)].filter((id) => /^\d+$/.test(id));
  if (ids.length === 0) return new Map();
  const pieces = await prisma.scrapePiece.findMany({
    where: { status: 'failed', tournamentId: { in: ids.map((id) => BigInt(id)) } },
    orderBy: [{ kind: 'asc' }, { key: 'asc' }],
    select: { tournamentId: true, label: true, httpStatus: true, lastError: true },
  });
  const byId = new Map<string, FailedPieceLike[]>();
  for (const p of pieces) {
    const id = p.tournamentId.toString();
    byId.set(id, [...(byId.get(id) ?? []), p]);
  }
  return new Map(ids.map((id) => [id, tabState(id, byId.get(id) ?? [])] as const));
}
