import { prisma } from '@/lib/db';
import type { NavigationStructure } from './parseNav';
import type { ApiTabsResult } from './tabbycatApi';

// A scrape is recorded as pieces (one per tab, per break category, per
// results round) so a single flaky page can be retried and re-scraped alone
// instead of failing or redoing the whole tournament.

export type PieceKind = 'team' | 'speaker' | 'participants' | 'motions' | 'break' | 'round';

export type PieceRef = { kind: PieceKind; key: string };

export type PieceOutcome = PieceRef & {
  label: string;
  url: string;
  ok: boolean;
  httpStatus: number | null;
  error: string | null;
};

/**
 * Identity of a piece within its tournament. Single tabs need no key; a break
 * is told apart by its category slug and a round by its number. A round URL
 * with no number (unusual installs) falls back to its path so it still gets a
 * stable, unique key.
 */
export function pieceRefForUrl(kind: PieceKind, url: string): PieceRef {
  if (kind !== 'break' && kind !== 'round') return { kind, key: '' };
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    // Not an absolute URL: treat the input as the path itself.
  }
  if (kind === 'break') {
    const last = path.split('/').filter(Boolean).pop() ?? '';
    return { kind, key: last.toLowerCase() };
  }
  const n = /\/results\/round\/(\d+)(?:\/|$)/.exec(path)?.[1];
  return { kind, key: n ?? path };
}

/** "R3" for a numbered prelim; outrounds keep their own name ("Grand Final"). */
export function roundPieceLabel(roundNumber: number | null, roundLabel: string | null): string {
  if (roundNumber != null && roundLabel != null && /^round\s+\d+$/i.test(roundLabel.trim())) {
    return `R${roundNumber}`;
  }
  return roundLabel ?? (roundNumber != null ? `R${roundNumber}` : '');
}

const TAB_LABELS: Record<Exclude<PieceKind, 'break' | 'round'>, string> = {
  team: 'Team tab',
  speaker: 'Speaker tab',
  participants: 'Participants',
  motions: 'Motions',
};

/**
 * What the owner sees for a piece. The nav carries no names for break tabs,
 * so a break is named by its URL category ("open" → "Break: Open"); a round
 * by the nav's own link text for it.
 */
export function pieceLabel(
  kind: PieceKind,
  url: string,
  roundLabels: Record<string, string> = {},
): string {
  if (kind === 'break') {
    let path = url;
    try {
      path = new URL(url).pathname;
    } catch {
      // Not an absolute URL: treat the input as the path itself.
    }
    const seg = path.split('/').filter(Boolean).pop() ?? '';
    return `Break: ${seg.charAt(0).toUpperCase()}${seg.slice(1)}`;
  }
  if (kind === 'round') {
    const key = pieceRefForUrl('round', url).key;
    const n = /^\d+$/.test(key) ? Number(key) : null;
    return roundPieceLabel(n, roundLabels[url] ?? null);
  }
  return TAB_LABELS[kind];
}

/**
 * One page's outcome: failed when `error` is set. A status of 0 (the request
 * never got an answer: timeout, network) is stored as null, as is the status
 * of an API answer standing in for a page.
 */
export function pieceOutcome(
  kind: PieceKind,
  url: string,
  result: { status: number | null; error?: string; roundLabels?: Record<string, string> },
): PieceOutcome {
  return {
    ...pieceRefForUrl(kind, url),
    label: pieceLabel(kind, url, result.roundLabels),
    url,
    ok: result.error == null,
    httpStatus: result.status || null,
    error: result.error ?? null,
  };
}

/** Whether `only` asks for this piece; no `only` means every piece. */
export function wantsPiece(only: PieceRef[] | undefined, ref: PieceRef): boolean {
  return !only || only.some((o) => o.kind === ref.kind && o.key === ref.key);
}

/**
 * The landing nav cut down to the pages `only` asks for. A partial re-scrape
 * runs the same fetch code as a full one; it just sees fewer links, so a page
 * nobody asked for is never requested.
 */
export function navForPieces(
  nav: NavigationStructure,
  only: PieceRef[] | undefined,
): NavigationStructure {
  if (!only) return nav;
  const keep = (kind: PieceKind, url: string | null) =>
    url && wantsPiece(only, pieceRefForUrl(kind, url)) ? url : null;
  return {
    ...nav,
    teamTab: keep('team', nav.teamTab),
    speakerTab: keep('speaker', nav.speakerTab),
    motionsTab: keep('motions', nav.motionsTab),
    participants: keep('participants', nav.participants),
    resultsRounds: nav.resultsRounds.filter((u) => keep('round', u)),
    breakTabs: nav.breakTabs.filter((u) => keep('break', u)),
  };
}

/**
 * The Tabbycat API answers team and speaker standings together. On a partial
 * re-scrape the tab nobody asked for is sent back to `html`, whose nav link
 * navForPieces has already dropped, so it yields neither rows nor a warning.
 */
export function apiTabsForPieces(
  result: ApiTabsResult,
  only: PieceRef[] | undefined,
): ApiTabsResult {
  const skip = { source: 'html', reason: 'not requested' } as const;
  return {
    teams: wantsPiece(only, { kind: 'team', key: '' }) ? result.teams : skip,
    speakers: wantsPiece(only, { kind: 'speaker', key: '' }) ? result.speakers : skip,
  };
}

/** Whether any piece of this kind loaded (a break or round: any one of them). */
export function pieceLoaded(fetched: PieceRef[], kind: PieceKind): boolean {
  return fetched.some((p) => p.kind === kind);
}

/**
 * The one warning a partial ingest carries, naming each page that did not
 * load: `partial: 2 page(s) did not load — Speaker tab (HTTP 504); R2 (HTTP 504)`.
 * Null when every page loaded. The per-page detail lives in ScrapePiece; this
 * is only the line the ingest result shows.
 */
export function partialWarning(outcomes: PieceOutcome[]): string | null {
  const failed = outcomes.filter((o) => !o.ok);
  if (failed.length === 0) return null;
  const why = (o: PieceOutcome) =>
    o.httpStatus != null ? `HTTP ${o.httpStatus}` : (o.error ?? 'no answer');
  return (
    `partial: ${failed.length} page(s) did not load — ` +
    failed.map((o) => `${o.label} (${why(o)})`).join('; ')
  );
}

const RETRY_DELAYS_MS = [15 * 60_000, 60 * 60_000, 6 * 60 * 60_000, 24 * 60 * 60_000];

/** Wait before the next try after the nth consecutive failure; null = stop retrying. */
export function retryDelayMs(failures: number): number | null {
  return RETRY_DELAYS_MS[failures - 1] ?? null;
}

/**
 * Upserts one row per outcome. A failure must not forget the last good load,
 * so `loadedAt` is only written on success. The new attempt count is only
 * known after the increment, so the retry time is set in a second write.
 */
export async function recordPieceOutcomes(
  tournamentId: bigint,
  outcomes: PieceOutcome[],
  now: Date = new Date(),
): Promise<void> {
  for (const o of outcomes) {
    const where = { tournamentId_kind_key: { tournamentId, kind: o.kind, key: o.key } };
    const base = { label: o.label, url: o.url, lastAttemptAt: now };
    if (o.ok) {
      const ok = { ...base, status: 'ok', attempts: 0, loadedAt: now, nextRetryAt: null };
      await prisma.scrapePiece.upsert({
        where,
        create: {
          tournamentId,
          kind: o.kind,
          key: o.key,
          httpStatus: o.httpStatus,
          lastError: null,
          ...ok,
        },
        update: { ...ok, httpStatus: o.httpStatus, lastError: null },
      });
      continue;
    }
    const failed = { ...base, status: 'failed', httpStatus: o.httpStatus, lastError: o.error };
    const row = await prisma.scrapePiece.upsert({
      where,
      create: { tournamentId, kind: o.kind, key: o.key, ...failed, attempts: 1 },
      update: { ...failed, attempts: { increment: 1 } },
    });
    const delay = retryDelayMs(row.attempts);
    await prisma.scrapePiece.update({
      where: { id: row.id },
      data: { nextRetryAt: delay == null ? null : new Date(now.getTime() + delay) },
    });
  }
}
