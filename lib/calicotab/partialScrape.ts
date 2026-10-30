import { prisma } from '@/lib/db';
import {
  acquireScrapeClaim,
  loadPublicLanding,
  recordEveryJudgeFromRoundResults,
  releaseScrapeClaim,
  runFullScrape,
  ScrapeBusyError,
} from './ingest';
import type { NavigationStructure } from './parseNav';
import { publicTournamentBase } from './prescrape';
import { pieceRefForUrl, type PieceKind, type PieceRef } from './scrapePieces';

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
 * of the tournament holds the claim, and a plain Error when the tournament is
 * unknown or has no public address to read.
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
  if (!tournament) throw new Error(`tournament ${tournamentId} not found`);
  let publicUrl: string;
  try {
    publicUrl = publicTournamentBase(tournament.sourceUrlRaw).base;
  } catch (err) {
    throw new Error(
      `tournament ${tournamentId} has no public address to re-scrape: ${(err as Error).message}`,
    );
  }

  const requestedRaw: PieceRef[] =
    pieces === 'failed'
      ? (
          await prisma.scrapePiece.findMany({
            where: { tournamentId, status: 'failed' },
            select: { kind: true, key: true },
          })
        ).map((p) => ({ kind: p.kind as PieceKind, key: p.key }))
      : pieces;
  // One entry per piece, whatever the caller sent.
  const requested = [...new Map(requestedRaw.map((p) => [refId(p), p])).values()];
  const result: PartialResult = { tournamentId, loaded: [], failed: [], notOnTab: [] };
  if (requested.length === 0) return result;

  const { base, loaded } = await loadPublicLanding(publicUrl, opts.deadline);
  // The landing page must lead back to this tournament: writing its pieces
  // under another row's fingerprint would mix two tournaments' results.
  if (loaded.existing?.id !== tournamentId) {
    throw new Error(`the public page ${base} no longer matches tournament ${tournamentId}`);
  }

  // A piece the tab no longer links (a round withdrawn, a break category
  // renamed) has nothing to fetch. Its stored rows stay: clearing them on
  // the strength of a missing link would delete data no page replaces.
  const onNav = navPieceIds(loaded.snapshot.navigation);
  const only = requested.filter((p) => onNav.has(refId(p)));
  result.notOnTab = requested.filter((p) => !onNav.has(refId(p)));
  if (only.length === 0) return result;

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
  } finally {
    // The write transaction clears the claim on success; this covers a
    // failure before it, so the next attempt need not wait out the TTL.
    await releaseScrapeClaim(tournamentId);
  }
  return result;
}
