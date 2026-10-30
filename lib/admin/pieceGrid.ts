import type { PieceRow } from '@/lib/admin/scrapeHealth';
import type { PieceKind } from '@/lib/calicotab/scrapePieces';
import { postJson } from '@/lib/utils/api';
import { relativeTime } from '@/lib/utils/relativeTime';

/**
 * The per-tournament piece grid's model: what a card shows, how a selection
 * becomes a request, and how the answer becomes a sentence. Kept apart from
 * the client component so the server page can shape the cards (a 'use client'
 * module's functions are references on the server, not callables) and so the
 * selection logic is testable without a DOM.
 */

/** The route's cap on pieces per request (app/api/admin/tournaments/[id]/rescrape). */
export const MAX_PIECES = 40;

/** A piece as the client receives it: no Dates, times already in words. */
export type PieceCard = {
  /** `kind:key`, unique within a tournament. */
  id: string;
  kind: PieceKind;
  key: string;
  label: string;
  status: 'ok' | 'failed';
  /** "Loaded" or "Failed · HTTP 504" (just "Failed" when no status came back). */
  pill: string;
  /** What the time is: when it loaded, or when it was last tried and failed. */
  timeLabel: 'Loaded' | 'Last tried';
  time: { text: string; iso: string };
  attempts: number;
};

export const pieceId = (p: { kind: string; key: string }) => `${p.kind}:${p.key}`;

/**
 * A loaded piece shows when it loaded; a failed one, when it was last tried.
 * A piece that is "ok" without a `loadedAt` (should not happen, but the
 * column is nullable) falls back to its last attempt rather than showing no
 * time at all.
 */
export function toPieceCard(p: PieceRow, now: Date): PieceCard {
  const ok = p.status === 'ok';
  const at = ok ? (p.loadedAt ?? p.lastAttemptAt) : p.lastAttemptAt;
  return {
    id: pieceId(p),
    kind: p.kind,
    key: p.key,
    label: p.label,
    status: p.status,
    pill: ok ? 'Loaded' : p.httpStatus != null ? `Failed · HTTP ${p.httpStatus}` : 'Failed',
    timeLabel: ok ? 'Loaded' : 'Last tried',
    time: { text: relativeTime(at, now), iso: at.toISOString() },
    attempts: p.attempts,
  };
}

// The order the tab site's own menu lists them in; breaks come after the
// single tabs, by name, since a tournament has a variable number of them.
const TAB_ORDER: PieceKind[] = ['team', 'speaker', 'participants', 'motions', 'break'];

/** Team, speaker, participants, motions, then each break by label. */
export function orderTabs<T extends { kind: PieceKind; label: string }>(tabs: readonly T[]): T[] {
  return [...tabs].sort(
    (a, b) =>
      TAB_ORDER.indexOf(a.kind) - TAB_ORDER.indexOf(b.kind) || a.label.localeCompare(b.label),
  );
}

/** "Select failed": every failed piece on the page. */
export function selectFailed(pieces: readonly PieceCard[]): Set<string> {
  return new Set(pieces.filter((p) => p.status === 'failed').map((p) => p.id));
}

/**
 * The request body for the ticked pieces, in the grid's order (tabs, then
 * rounds) rather than the order they were ticked, so the same selection
 * always sends the same request. Ids no longer on the page are dropped.
 */
export function piecesPayload(
  pieces: readonly PieceCard[],
  selected: ReadonlySet<string>,
): { pieces: Array<{ kind: PieceKind; key: string }> } {
  return {
    pieces: pieces.filter((p) => selected.has(p.id)).map((p) => ({ kind: p.kind, key: p.key })),
  };
}

/**
 * Checked on press, not by disabling the button (UX-16): a disabled button
 * cannot say why it will not work. Null when the selection can be sent.
 */
export function validateSelection(count: number): string | null {
  if (count === 0) return 'Tick at least one piece to re-scrape.';
  if (count > MAX_PIECES) {
    return `Pick at most ${MAX_PIECES} pieces at a time. ${count} are ticked.`;
  }
  return null;
}

export type RescrapeResponse = {
  loaded: unknown[];
  failed: unknown[];
  notOnTab: unknown[];
};

/** "Loaded 3 · Failed 1 · Not on the tab any more 0": all three, even at zero. */
export function resultLine(data: RescrapeResponse): string {
  return (
    `Loaded ${data.loaded.length} · Failed ${data.failed.length} · ` +
    `Not on the tab any more ${data.notOnTab.length}`
  );
}

export function rescrapePieces(tournamentId: string, body: ReturnType<typeof piecesPayload>) {
  return postJson<RescrapeResponse>(`/api/admin/tournaments/${tournamentId}/rescrape`, body);
}
