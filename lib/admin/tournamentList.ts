import { prisma } from '@/lib/db';
import { band } from '@/lib/audit/score';
import { publicPieceUrl } from '@/lib/audit/types';
import { PARSER_VERSION } from '@/lib/calicotab/version';

/**
 * Read model for /admin/tournaments: every stored tournament, newest scrape
 * first, twenty a page (owner, 2026-10-31: "make it a page with a page, 20
 * per page, I click Next"). The page is read with skip/take, and the
 * columns that live in other tables (the audit score, failing pieces, users
 * with it on their CV) are read for that page's twenty ids only, one batched
 * query each, so the cost of a page does not grow with the database.
 */

export const TOURNAMENTS_PER_PAGE = 20;

export type TournamentListRow = {
  id: string;
  name: string;
  /** The public tab, made public here; null when the stored URL is unreadable. */
  tabUrl: string | null;
  year: number | null;
  format: string | null;
  scrapedAt: Date;
  parserCurrent: boolean;
  score: number | null;
  band: 'good' | 'check' | 'rescrape' | null;
  partlyLoaded: boolean;
  /** Users with a linked URL to it: on that many CVs. */
  onCvs: number;
};

export type TournamentList = {
  rows: TournamentListRow[];
  total: number;
  /** The page shown, after clamping to 1..pages. */
  page: number;
  /** At least 1, so an empty list is "page 1 of 1". */
  pages: number;
};

export async function listTournaments({
  page,
  q,
}: {
  page: number;
  q?: string;
}): Promise<TournamentList> {
  const name = q?.trim();
  const where = name ? { name: { contains: name, mode: 'insensitive' as const } } : {};
  // Counted first, so a page past the end (an old link, a list that shrank)
  // can clamp to the last page instead of showing an empty one.
  const total = await prisma.tournament.count({ where });
  const pages = Math.max(1, Math.ceil(total / TOURNAMENTS_PER_PAGE));
  const shown = Number.isFinite(page) ? Math.min(Math.max(Math.trunc(page), 1), pages) : 1;
  const tournaments = await prisma.tournament.findMany({
    where,
    // id breaks ties, so two rows scraped in one batch keep their order
    // between page loads and never show on two pages or none.
    orderBy: [{ scrapedAt: 'desc' }, { id: 'desc' }],
    skip: (shown - 1) * TOURNAMENTS_PER_PAGE,
    take: TOURNAMENTS_PER_PAGE,
    select: {
      id: true,
      name: true,
      sourceUrlRaw: true,
      year: true,
      format: true,
      scrapedAt: true,
      parserVersion: true,
    },
  });
  const facts = await pageFacts(tournaments.map((t) => t.id));
  return {
    rows: tournaments.map((t) => {
      const score = facts.scores.get(t.id) ?? null;
      return {
        id: t.id.toString(),
        name: t.name,
        tabUrl: publicPieceUrl(t.sourceUrlRaw),
        year: t.year,
        format: t.format,
        scrapedAt: t.scrapedAt,
        parserCurrent: t.parserVersion === PARSER_VERSION,
        score,
        band: score == null ? null : band(score),
        partlyLoaded: facts.partly.has(t.id),
        onCvs: facts.users.get(t.id) ?? 0,
      };
    }),
    total,
    page: shown,
    pages,
  };
}

/** Score, partly loaded and users per id, one query each for the page's ids. */
async function pageFacts(ids: bigint[]) {
  if (ids.length === 0) {
    return {
      scores: new Map<bigint, number>(),
      partly: new Set<bigint>(),
      users: new Map<bigint, number>(),
    };
  }
  const tournamentId = { in: ids };
  const [audits, failing, links] = await Promise.all([
    prisma.tournamentAudit.findMany({
      where: { tournamentId },
      select: { tournamentId: true, score: true },
    }),
    prisma.scrapePiece.groupBy({ by: ['tournamentId'], where: { tournamentId, status: 'failed' } }),
    // One group per (tournament, user), as the audit counts usersAffected.
    prisma.discoveredUrl.groupBy({ by: ['tournamentId', 'userId'], where: { tournamentId } }),
  ]);
  const users = new Map<bigint, number>();
  for (const l of links) {
    if (l.tournamentId != null) users.set(l.tournamentId, (users.get(l.tournamentId) ?? 0) + 1);
  }
  return {
    scores: new Map(audits.map((a) => [a.tournamentId, a.score] as const)),
    partly: new Set(failing.map((f) => f.tournamentId)),
    users,
  };
}
