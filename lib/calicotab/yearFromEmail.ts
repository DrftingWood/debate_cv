import { prisma } from '@/lib/db';

/**
 * Give a stored tournament with no year the year its private URLs were
 * emailed (owner, 2026-10-30).
 *
 * The pre-scrape reads public tabs, which carry no date, so a tournament
 * whose name holds no year ("Autumn Novice") is stored with year null. The
 * first private URL a user's Gmail scan links to it says when it ran: the
 * earliest email date among every link to the tournament is used, as the
 * live ingest does for one user's link (inferTournamentYear).
 *
 * Only a missing year is filled. A year read from the name, or one an
 * earlier ingest inferred, is left alone, and the fingerprint is never
 * touched: lookups still find the row under its year-null fingerprint
 * (candidateFingerprints tries it for every inferred year).
 * Returns the year written, or null when nothing changed.
 */
export async function fillTournamentYearFromEmails(tournamentId: bigint): Promise<number | null> {
  const { _min } = await prisma.discoveredUrl.aggregate({
    where: { tournamentId, messageDate: { not: null } },
    _min: { messageDate: true },
  });
  const earliest = _min.messageDate;
  if (!earliest) return null;
  const year = earliest.getUTCFullYear();
  const { count } = await prisma.tournament.updateMany({
    where: { id: tournamentId, year: null },
    data: { year },
  });
  return count > 0 ? year : null;
}
