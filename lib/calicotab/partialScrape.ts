import * as Sentry from '@sentry/nextjs';
import { prisma } from '@/lib/db';
import {
  acquireScrapeClaim,
  FetchCutOffError,
  loadPublicLanding,
  NothingLoadedError,
  recordEveryJudgeFromRoundResults,
  releaseScrapeClaim,
  runFullScrape,
  ScrapeBusyError,
} from './ingest';
import { isIngestDeadlineError } from './fetchSession';
import type { NavigationStructure } from './parseNav';
import { publicTournamentBase } from './prescrape';
import { recordStaffFromHome } from './staffStore';
import {
  pieceOutcome,
  pieceRefForUrl,
  recordPieceOutcomes,
  recordPiecesNotReached,
  type PieceKind,
  type PieceRef,
} from './scrapePieces';

/**
 * Partial scrapes (owner decision 2026-10-30): re-scrape one tab, one break
 * category or one round of a stored tournament, and replace only that piece's
 * rows. A flaky round no longer costs a whole re-scrape, and a re-scrape of
 * one round cannot disturb the rounds around it.
 *
 * It runs the pre-scrape's path (public pages, no owner, the same judge-panel
 * writer) with `only` set, which narrows the fetch to the requested pages,
 * skips the tournament-wide refresh and the regression guard, and clears each
 * loaded piece's rows inside the write (scrapePieces.clearPieces).
 */

export { ScrapeBusyError };

/**
 * The tournament is unknown, or has no public address to read. The admin API
 * maps it to 404 by class rather than by message, so rewording the message
 * cannot turn a 404 into a 500.
 */
export class TournamentNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TournamentNotFoundError';
  }
}

export type PartialResult = {
  tournamentId: bigint;
  /** Requested pieces whose page loaded and whose rows were rewritten. */
  loaded: PieceRef[];
  /** Requested pieces whose page failed; their stored rows are untouched. */
  failed: PieceRef[];
  /** Requested pieces the tab no longer links; reported, never cleared. */
  notOnTab: PieceRef[];
};

const refId = (p: PieceRef) => `${p.kind}:${p.key}`;

/** Every piece the landing nav links, by identity. */
function navPieceIds(nav: NavigationStructure): Set<string> {
  const ids = new Set<string>();
  const add = (kind: PieceKind, url: string | null) => {
    if (url) ids.add(refId(pieceRefForUrl(kind, url)));
  };
  add('team', nav.teamTab);
  add('speaker', nav.speakerTab);
  add('motions', nav.motionsTab);
  add('participants', nav.participants);
  for (const u of nav.resultsRounds) add('round', u);
  for (const u of nav.breakTabs) add('break', u);
  return ids;
}

/**
 * Re-scrapes the given pieces of a stored tournament; `'failed'` means every
 * piece whose last attempt failed. Throws ScrapeBusyError when another scrape
 * of the tournament holds the claim, TournamentNotFoundError when the
 * tournament is unknown or has no public address to read, and a plain Error
 * when its landing page fails or no longer leads back to it.
 *
 * Every way of failing except ScrapeBusyError counts as an attempt for the
 * requested pieces (recordPiecesNotReached), so the retry's back-off always
 * advances. Running out of time is a result, not an error: the pieces not
 * written are reported failed, as a page that timed out would be.
 *
 * Nothing left to do (no pieces requested, or none still on the tab) returns
 * after at most the landing page, without taking the claim.
 */
export async function rescrapePieces(
  tournamentId: bigint,
  pieces: PieceRef[] | 'failed',
  opts: { deadline?: number } = {},
): Promise<PartialResult> {
  const tournament = await prisma.tournament.findUnique({ where: { id: tournamentId } });
  // Its ScrapePiece rows went with it (onDelete: Cascade): nothing to record.
  if (!tournament) throw new TournamentNotFoundError(`tournament ${tournamentId} not found`);

  const requested = await requestedPieces(tournamentId, pieces);
  const result: PartialResult = { tournamentId, loaded: [], failed: [], notOnTab: [] };
  if (requested.length === 0) return result;

  const landing = await landingFor(tournament, requested, opts.deadline);
  if (!landing) return { ...result, failed: requested };
  const { base, loaded } = landing;

  // The home page is the landing page just fetched: its piece needs no
  // request of its own and no fetch-phase machinery (no tab to narrow the nav
  // to, no rows to clear). It is read after the tabs, so a participants list
  // re-read in the same press is what its names are linked against.
  const tabs = requested.filter((p) => p.kind !== 'home');
  await scrapeTabs(tournamentId, tabs, landing, result);
  if (tabs.length < requested.length) {
    await readHome(tournamentId, base, loaded.landingHtml, result);
  }
  return result;
}

/** The tab, break and round pieces of a re-scrape, written under the scrape claim. */
async function scrapeTabs(
  tournamentId: bigint,
  tabs: PieceRef[],
  landing: NonNullable<Awaited<ReturnType<typeof landingFor>>>,
  result: PartialResult,
): Promise<void> {
  const { base, loaded } = landing;
  // A piece the tab no longer links (a round withdrawn, a break category
  // renamed) has nothing to fetch. Its stored rows stay: clearing them on
  // the strength of a missing link would delete data no page replaces. Its
  // ScrapePiece row goes, though: it is no longer a piece of the tournament,
  // and a 'failed' row left behind would be asked for again on every retry.
  const onNav = navPieceIds(loaded.snapshot.navigation);
  const only = tabs.filter((p) => onNav.has(refId(p)));
  result.notOnTab = tabs.filter((p) => !onNav.has(refId(p)));
  if (result.notOnTab.length > 0) {
    await prisma.scrapePiece.deleteMany({
      where: { tournamentId, OR: result.notOnTab.map((p) => ({ kind: p.kind, key: p.key })) },
    });
  }
  if (only.length === 0) return;

  const claim = await acquireScrapeClaim(tournamentId);
  if (claim === 'busy') throw new ScrapeBusyError(base);
  try {
    await runFullScrape(loaded, null, { only }, async ({ fetched, persons, tournamentId: id }) => {
      // The pre-scrape's judge writer, as the pre-scrape runs it: it replaces
      // the round_results panels of exactly the rounds that loaded
      // (judgeRowsOwnedByRounds), so a re-scraped round's panels are fresh
      // and every other round's stay.
      await recordEveryJudgeFromRoundResults(fetched.rounds, id, persons.lookupPersonId);
      for (const o of fetched.pieceOutcomes) {
        (o.ok ? result.loaded : result.failed).push({ kind: o.kind, key: o.key });
      }
    });
  } catch (err) {
    if (isIngestDeadlineError(err)) {
      await recordCutOff(tournamentId, only, err);
      result.failed = only;
      return;
    }
    // Every requested page failed. runFullScrape has recorded each failure
    // (so its back-off advances); to the caller that is a result, not an
    // error: these pieces failed, and their stored rows are untouched.
    if (!(err instanceof NothingLoadedError)) throw err;
    result.failed = err.outcomes.map((o) => ({ kind: o.kind, key: o.key }));
  } finally {
    // The write transaction clears the claim on success; this covers a
    // failure before it, so the next attempt need not wait out the TTL.
    await releaseScrapeClaim(tournamentId);
  }
}

/**
 * Reads the Tournament Staff block off the landing page already in hand and
 * records the home piece: loaded when the names are stored, failed (and so
 * retried on the usual back-off) when the write fails. The page is the public
 * tab address, never a private URL.
 */
async function readHome(
  tournamentId: bigint,
  base: string,
  landingHtml: string,
  result: PartialResult,
): Promise<void> {
  const ref = { kind: 'home' as const, key: '' };
  try {
    await recordStaffFromHome(tournamentId, landingHtml);
    await recordPieceOutcomes(tournamentId, [pieceOutcome('home', base, { status: 200 })]);
    result.loaded.push(ref);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { stage: 'home-piece' },
      extra: { tournamentId: String(tournamentId) },
    });
    await recordPieceOutcomes(tournamentId, [
      pieceOutcome('home', base, { status: null, error: 'could not store the staff block' }),
    ]);
    result.failed.push(ref);
  }
}

/** The pieces asked for, one entry each; `'failed'` reads them from the table. */
async function requestedPieces(
  tournamentId: bigint,
  pieces: PieceRef[] | 'failed',
): Promise<PieceRef[]> {
  const raw: PieceRef[] =
    pieces === 'failed'
      ? (
          await prisma.scrapePiece.findMany({
            where: { tournamentId, status: 'failed' },
            select: { kind: true, key: true },
          })
        ).map((p) => ({ kind: p.kind as PieceKind, key: p.key }))
      : pieces;
  return [...new Map(raw.map((p) => [refId(p), p])).values()];
}

/**
 * The tournament's public landing page, checked to lead back to it. Any
 * failure counts as an attempt for the requested pieces before it is thrown;
 * a deadline is not thrown but answered with null (every piece failed).
 */
async function landingFor(
  tournament: { id: bigint; sourceUrlRaw: string },
  refs: PieceRef[],
  deadline: number | undefined,
): Promise<Awaited<ReturnType<typeof loadPublicLanding>> | null> {
  const target = { tournamentId: tournament.id, refs };
  let publicUrl: string;
  try {
    publicUrl = publicTournamentBase(tournament.sourceUrlRaw).base;
  } catch (err) {
    const notFound = new TournamentNotFoundError(
      `tournament ${tournament.id} has no public address to re-scrape: ${(err as Error).message}`,
    );
    // No address will appear on its own: stop the automatic retries now
    // rather than after five more failures.
    await notReached(target, notFound, false);
    throw notFound;
  }
  try {
    const landing = await loadPublicLanding(publicUrl, deadline);
    // The landing page must lead back to this tournament: writing its pieces
    // under another row's fingerprint would mix two tournaments' results.
    if (landing.loaded.existing?.id !== tournament.id) {
      throw new Error(
        `the public page ${landing.base} no longer matches tournament ${tournament.id}`,
      );
    }
    return landing;
  } catch (err) {
    await notReached(target, err, true);
    if (isIngestDeadlineError(err)) return null;
    throw err;
  }
}

/**
 * Out of time before the write: nothing was written, so every piece asked
 * for failed. A page that answered with an error is recorded as that
 * failure; the rest (never reached, or read but not written) count an
 * attempt without a verdict on their page.
 */
async function recordCutOff(tournamentId: bigint, only: PieceRef[], err: unknown) {
  const answered = err instanceof FetchCutOffError ? err.outcomes.filter((o) => !o.ok) : [];
  await recordPieceOutcomes(tournamentId, answered);
  const answeredIds = new Set(answered.map(refId));
  const refs = only.filter((p) => !answeredIds.has(refId(p)));
  await notReached({ tournamentId, refs }, err, true);
}

/** recordPiecesNotReached with the error's own words and HTTP status. */
function notReached(
  target: { tournamentId: bigint; refs: PieceRef[] },
  err: unknown,
  retry: boolean,
) {
  const httpStatus = (err as { httpStatus?: unknown }).httpStatus;
  return recordPiecesNotReached(target.tournamentId, target.refs, {
    error: err instanceof Error ? err.message : String(err),
    httpStatus: typeof httpStatus === 'number' ? httpStatus : null,
    retry,
  });
}

/*
 * Time one tournament's retry needs before it is worth starting: a landing
 * page, the requested pages and the write. Starting with less leaves a
 * half-done scrape for the platform to kill, so the loop ends the tick instead.
 */
const RETRY_HEADROOM_MS = 20_000;
const RETRY_TOURNAMENTS_PER_TICK = 20;

/**
 * Retries every piece whose back-off has run out (status 'failed', nextRetryAt
 * due), one tournament at a time: calicotab is treated as one host, so
 * tournaments are not hit in parallel. The oldest due piece goes first. A
 * tournament another scrape holds is skipped (its pieces stay due for the next
 * tick); any other error is reported and the loop moves on, because one broken
 * tournament must not starve the rest. `rescrape` is injectable for tests.
 */
export async function retryDuePieces(opts: {
  deadline: number;
  now?: Date;
  rescrape?: typeof rescrapePieces;
}): Promise<{ tournaments: number; loaded: number; failed: number }> {
  const rescrape = opts.rescrape ?? rescrapePieces;
  // Bounded in two steps: a backlog of thousands of due pieces must not be
  // loaded every tick when a tick works through a few tournaments. First the
  // next tournaments by their oldest due piece, then only their pieces.
  const dueWhere = { status: 'failed', nextRetryAt: { lte: opts.now ?? new Date() } };
  const next = await prisma.scrapePiece.groupBy({
    by: ['tournamentId'],
    where: dueWhere,
    _min: { nextRetryAt: true },
    orderBy: { _min: { nextRetryAt: 'asc' } },
    take: RETRY_TOURNAMENTS_PER_TICK,
  });
  const due =
    next.length === 0
      ? []
      : await prisma.scrapePiece.findMany({
          where: { ...dueWhere, tournamentId: { in: next.map((n) => n.tournamentId) } },
          orderBy: { nextRetryAt: 'asc' },
          select: { tournamentId: true, kind: true, key: true },
        });
  const byTournament = new Map<bigint, PieceRef[]>();
  for (const p of due) {
    const refs = byTournament.get(p.tournamentId) ?? [];
    refs.push({ kind: p.kind as PieceKind, key: p.key });
    byTournament.set(p.tournamentId, refs);
  }
  const total = { tournaments: 0, loaded: 0, failed: 0 };
  for (const [tournamentId, refs] of byTournament) {
    if (Date.now() >= opts.deadline - RETRY_HEADROOM_MS) break;
    try {
      const r = await rescrape(tournamentId, refs, { deadline: opts.deadline });
      total.tournaments += 1;
      total.loaded += r.loaded.length;
      total.failed += r.failed.length;
    } catch (err) {
      if (err instanceof ScrapeBusyError) continue;
      // Out of time is the tick ending, not a fault: stop quietly.
      if (isIngestDeadlineError(err)) break;
      Sentry.captureException(err, {
        tags: { stage: 'piece-retry' },
        extra: { tournamentId: String(tournamentId) },
      });
    }
  }
  return total;
}
