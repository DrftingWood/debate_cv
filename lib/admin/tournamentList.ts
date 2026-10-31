import { prisma } from '@/lib/db';
import { band } from '@/lib/audit/score';
import { publicPieceUrl } from '@/lib/audit/types';
import { PARSER_VERSION } from '@/lib/calicotab/version';
import { parseChecks, type Band } from '@/lib/admin/accuracy';
import { loadTabStates, tabState, type TabState } from '@/lib/admin/tabStatus';
import {
  hasFilters,
  matchesFilters,
  needsChecks,
  type TournamentFilters,
} from '@/lib/admin/tournamentFilters';

/**
 * Read model for the Tournaments tab: every stored tournament, lowest audit
 * score first (owner, 2026-10-31: work through what is wrong before what is
 * fine), twenty a page ("I click Next"). The filters (a failing check, a
 * score band, an open question, tournaments with marks) narrow it.
 *
 * The order is by a figure that lives in another table, so the whole list is
 * ordered here, from two light reads (the tournaments' ids and the audits'
 * scores, with the checks' JSON only when a filter needs it) rather than by
 * the database; only the page's twenty rows are then read in full, with the
 * columns that live in other tables (failed pages, withheld pages, users with
 * it on their CV) read for those twenty ids alone, one batched query each. So
 * the cost of a page grows with the list's size in ids and scores, not in
 * columns.
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
  band: Band | null;
  /** How much of the tab loaded: the one status cell (✓ Loaded / ? Partly). */
  tab: TabState;
  /**
   * Pages the tournament keeps back (withheld or never published). Not a
   * failure and never highlighted as one; nothing retries them.
   */
  withheld: number;
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

type Scored = { score: number; usersAffected: number };

/** Score ranges of the three bands, as the database can filter them (see band()). */
const BAND_RANGE: Record<Band, { gte?: number; lt?: number }> = {
  good: { gte: 90 },
  check: { gte: 70, lt: 90 },
  rescrape: { lt: 70 },
};

/**
 * The audits that pass the filters, keyed by tournament id. The band is
 * asked of the database; the rest need each audit's checks, read only then.
 */
async function auditsFor(filters: TournamentFilters): Promise<Map<bigint, Scored>> {
  const withChecks = needsChecks(filters);
  const rows = await prisma.tournamentAudit.findMany({
    // Ignored tournaments (test and demo ones) are in the ignored view only.
    where: {
      ...(filters.band ? { score: BAND_RANGE[filters.band] } : {}),
      tournament: { ignored: Boolean(filters.ignored) },
    },
    select: {
      tournamentId: true,
      score: true,
      usersAffected: true,
      ...(withChecks ? { checks: true } : {}),
    },
  });
  const out = new Map<bigint, Scored>();
  for (const r of rows) {
    if (withChecks) {
      const checks = 'checks' in r ? parseChecks(r.checks) : [];
      if (!matchesFilters({ score: r.score, bandOf: band(r.score), checks }, filters)) continue;
    }
    out.set(r.tournamentId, { score: r.score, usersAffected: r.usersAffected });
  }
  return out;
}

/**
 * Unaudited last; then lowest score, the one on more CVs, the newest scrape.
 * The id breaks the last tie, so a row never shows on two pages or none.
 */
function lowestFirst(found: Array<{ id: bigint; scrapedAt: Date }>, audits: Map<bigint, Scored>) {
  return found
    .map((t) => ({ ...t, audit: audits.get(t.id) }))
    .sort(
      (a, b) =>
        Number(a.audit == null) - Number(b.audit == null) ||
        (a.audit?.score ?? 0) - (b.audit?.score ?? 0) ||
        (b.audit?.usersAffected ?? 0) - (a.audit?.usersAffected ?? 0) ||
        b.scrapedAt.getTime() - a.scrapedAt.getTime() ||
        (a.id < b.id ? 1 : -1),
    );
}

export async function listTournaments({
  page,
  q,
  filters = {},
}: {
  page: number;
  q?: string;
  filters?: TournamentFilters;
}): Promise<TournamentList> {
  const name = q?.trim();
  const audits = await auditsFor(filters);
  // With a filter the list is the audits that passed it; without one it is
  // every tournament, audited or not.
  const where = {
    ignored: Boolean(filters.ignored),
    ...(name ? { name: { contains: name, mode: 'insensitive' as const } } : {}),
    ...(hasFilters(filters) ? { id: { in: [...audits.keys()] } } : {}),
  };
  const found = await prisma.tournament.findMany({
    where,
    select: { id: true, scrapedAt: true },
  });
  const ordered = lowestFirst(found, audits);

  // Clamped, so a page past the end (an old link, a list that shrank) shows
  // the last page instead of an empty one.
  const total = ordered.length;
  const pages = Math.max(1, Math.ceil(total / TOURNAMENTS_PER_PAGE));
  const shown = Number.isFinite(page) ? Math.min(Math.max(Math.trunc(page), 1), pages) : 1;
  const ids = ordered
    .slice((shown - 1) * TOURNAMENTS_PER_PAGE, shown * TOURNAMENTS_PER_PAGE)
    .map((t) => t.id);

  const [stored, facts] = await Promise.all([pageRows(ids), pageFacts(ids)]);
  return {
    rows: ids.flatMap((id): TournamentListRow[] => {
      const t = stored.get(id);
      if (!t) return [];
      const score = audits.get(id)?.score ?? null;
      return [
        {
          id: id.toString(),
          name: t.name,
          tabUrl: publicPieceUrl(t.sourceUrlRaw),
          year: t.year,
          format: t.format,
          scrapedAt: t.scrapedAt,
          parserCurrent: t.parserVersion === PARSER_VERSION,
          score,
          band: score == null ? null : band(score),
          tab: facts.tabs.get(id.toString()) ?? tabState(id.toString(), []),
          withheld: facts.withheld.get(id) ?? 0,
          onCvs: facts.users.get(id) ?? 0,
        },
      ];
    }),
    total,
    page: shown,
    pages,
  };
}

/** The shown columns of the page's tournaments, by id. */
async function pageRows(ids: bigint[]) {
  // No ids (an empty list) asks nothing: `in: []` would be a wasted query.
  const rows =
    ids.length === 0
      ? []
      : await prisma.tournament.findMany({
          where: { id: { in: ids } },
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
  return new Map(rows.map((t) => [t.id, t] as const));
}

/** Tab state, withheld pages and users per id, one query each for the page's ids. */
async function pageFacts(ids: bigint[]) {
  if (ids.length === 0) {
    return {
      tabs: new Map<string, TabState>(),
      withheld: new Map<bigint, number>(),
      users: new Map<bigint, number>(),
    };
  }
  const tournamentId = { in: ids };
  const [tabs, withheld, links] = await Promise.all([
    loadTabStates(ids.map(String)),
    prisma.scrapePiece.groupBy({
      by: ['tournamentId'],
      where: { tournamentId, status: 'withheld' },
      _count: { _all: true },
    }),
    // One group per (tournament, user), as the audit counts usersAffected.
    prisma.discoveredUrl.groupBy({ by: ['tournamentId', 'userId'], where: { tournamentId } }),
  ]);
  const users = new Map<bigint, number>();
  for (const l of links) {
    if (l.tournamentId != null) users.set(l.tournamentId, (users.get(l.tournamentId) ?? 0) + 1);
  }
  return {
    tabs,
    withheld: new Map(withheld.map((w) => [w.tournamentId, w._count._all] as const)),
    users,
  };
}
