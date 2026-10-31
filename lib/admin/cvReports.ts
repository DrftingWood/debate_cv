import { prisma } from '@/lib/db';
import { reportPieces } from '@/lib/audit/checks';
import { dedupePieces } from '@/lib/audit/checkHelpers';
import type { AuditPiece } from '@/lib/audit/auditInputs';
import { publicPieceUrl } from '@/lib/audit/types';
import type { SuggestedPiece } from '@/lib/admin/accuracyActions';
import { tabState, type FailedPieceLike, type TabState } from '@/lib/admin/tabStatus';
import { scrubComment } from '@/lib/admin/scrub';
import { categoryLabel } from '@/lib/cvErrorReports/categories';
import type { PieceKind } from '@/lib/calicotab/scrapePieces';
import {
  clampPage,
  REPORTS_PER_PAGE,
  type ReportFilter,
  type ReportStatus,
} from '@/lib/admin/cvReportTypes';

/**
 * Read model for the "CV error reports" ledger on /admin (owner, 2026-10-31:
 * "remake the cv error table ... according to these guidelines": twenty a
 * page with Previous and Next, clickable public tab links, the ✓ / ? / ✗ Tab
 * status, and a way to act on each report).
 *
 * A page is read with skip/take, newest first, and everything a row shows
 * about its tournaments (name, public tab, Tab state, suggested pages) is
 * read for that page's tournaments only, in a fixed number of batched
 * queries, so a page costs the same however many reports exist.
 *
 * "Re-scrape suggested" offers the pages the audit engine's user_reports
 * check points at for the report's categories (lib/audit/checks.ts,
 * reportPieces): the same function, fed the same recorded pieces, so the
 * ledger and the tournament's accuracy checks can never disagree.
 *
 * A report's comment is the user's own text, and users paste their private
 * URLs into it; it is scrubbed like a review-set comment before it leaves
 * here.
 */

export type CvReportTournament = {
  id: string;
  /** The stored name, or "Tournament #id" for one that is no longer stored. */
  name: string;
  stored: boolean;
  /** The public tab address; null when not stored or unreadable. */
  tabUrl: string | null;
  tab: TabState;
  /** The pages the report's categories point at, URLs public. */
  suggested: SuggestedPiece[];
};

export type CvReportView = {
  id: string;
  createdAt: Date;
  reporter: { name: string | null; email: string | null };
  tournaments: CvReportTournament[];
  categories: Array<{ code: string; label: string }>;
  comment: string;
  status: ReportStatus;
};

export type CvReportList = {
  rows: CvReportView[];
  total: number;
  /** The page shown, after clamping to 1..pages. */
  page: number;
  /** At least 1. */
  pages: number;
  status: ReportFilter;
  /** Whether any report exists at all: "No CV reports yet" versus "No open reports". */
  anyReports: boolean;
};

/** A report names its tournaments by id as strings; only digit strings are ids. */
const isId = (id: string) => /^\d{1,18}$/.test(id);

export async function listCvReports({
  page,
  status = 'open',
}: {
  page: number;
  status?: ReportFilter;
}): Promise<CvReportList> {
  const where = status === 'all' ? {} : { status };
  // Counted first, so a page past the end clamps to the last one.
  const total = await prisma.cvErrorReport.count({ where });
  const anyReports = total > 0 || (status !== 'all' && (await prisma.cvErrorReport.count()) > 0);
  const pages = Math.max(1, Math.ceil(total / REPORTS_PER_PAGE));
  const shown = clampPage(page, pages);
  if (total === 0) return { rows: [], total, page: shown, pages, status, anyReports };

  const reports = await prisma.cvErrorReport.findMany({
    where,
    // id breaks ties, so two reports filed in one second keep their order
    // between page loads and never show on two pages or none.
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    skip: (shown - 1) * REPORTS_PER_PAGE,
    take: REPORTS_PER_PAGE,
    include: { user: { select: { name: true, email: true } } },
  });
  const facts = await tournamentFacts(reports.flatMap((r) => r.tournamentIds).filter(isId));

  const rows = reports.map((r): CvReportView => ({
    id: r.id,
    createdAt: r.createdAt,
    reporter: { name: r.user.name, email: r.user.email },
    tournaments: [...new Set(r.tournamentIds)].map((id) => tournamentOf(id, facts, r.categories)),
    categories: r.categories.map((code) => ({ code, label: categoryLabel(code) })),
    comment: scrubComment(r.comment),
    status: r.status,
  }));
  return { rows, total, page: shown, pages, status, anyReports };
}

type StoredFacts = {
  name: string;
  tabUrl: string | null;
  pieces: AuditPiece[];
  failed: FailedPieceLike[];
  prelimRoundCount: number | null;
  /** The highest prelim round on record, for a tournament whose round count was never stored. */
  maxRound: number | null;
};

/**
 * What the rows need about their tournaments, in at most three queries:
 * the tournaments, their recorded pieces (for the Tab state and the
 * suggestions), and, only for tournaments with no stored round count, the
 * highest prelim round on record (how the audit counts prelims then).
 */
async function tournamentFacts(ids: string[]): Promise<Map<string, StoredFacts>> {
  const unique = [...new Set(ids)].map((id) => BigInt(id));
  if (unique.length === 0) return new Map();
  const [tournaments, pieces] = await Promise.all([
    prisma.tournament.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true, sourceUrlRaw: true, prelimRoundCount: true },
    }),
    prisma.scrapePiece.findMany({
      where: { tournamentId: { in: unique } },
      orderBy: [{ kind: 'asc' }, { key: 'asc' }],
      select: {
        tournamentId: true,
        kind: true,
        key: true,
        label: true,
        status: true,
        url: true,
        httpStatus: true,
        lastError: true,
      },
    }),
  ]);
  const uncounted = tournaments.filter((t) => t.prelimRoundCount == null).map((t) => t.id);
  const maxRounds = uncounted.length
    ? await prisma.teamResult.groupBy({
        by: ['tournamentId'],
        where: { tournamentId: { in: uncounted }, roundNumber: { gte: 1 } },
        _max: { roundNumber: true },
      })
    : [];
  const maxById = new Map(maxRounds.map((g) => [g.tournamentId.toString(), g._max.roundNumber]));

  const out = new Map<string, StoredFacts>();
  for (const t of tournaments) {
    out.set(t.id.toString(), {
      name: t.name,
      tabUrl: publicPieceUrl(t.sourceUrlRaw),
      pieces: [],
      failed: [],
      prelimRoundCount: t.prelimRoundCount,
      maxRound: maxById.get(t.id.toString()) ?? null,
    });
  }
  for (const p of pieces) {
    const f = out.get(p.tournamentId.toString());
    if (!f) continue;
    f.pieces.push({
      kind: p.kind as PieceKind,
      key: p.key,
      label: p.label,
      status: p.status as AuditPiece['status'],
      url: p.url,
    });
    if (p.status === 'failed') f.failed.push(p);
  }
  return out;
}

function tournamentOf(
  id: string,
  facts: ReadonlyMap<string, StoredFacts>,
  categories: readonly string[],
): CvReportTournament {
  const f = isId(id) ? facts.get(id) : undefined;
  if (!f) {
    return {
      id,
      name: `Tournament #${id}`,
      stored: false,
      tabUrl: null,
      tab: tabState(null, []),
      suggested: [],
    };
  }
  // With no stored round count the audit counts prelims up to the highest
  // round on record; one row standing for that round says the same thing.
  const roundRows =
    f.prelimRoundCount == null && f.maxRound != null
      ? [{ team: '', round: f.maxRound, points: null, wins: null, position: null }]
      : [];
  const inputs = { pieces: f.pieces, prelimRoundCount: f.prelimRoundCount, roundRows };
  return {
    id,
    name: f.name,
    stored: true,
    tabUrl: f.tabUrl,
    tab: tabState(id, f.failed),
    suggested: dedupePieces(categories.flatMap((c) => reportPieces(c, inputs))),
  };
}

/**
 * What the review set's export says about flagged reports: who filed them,
 * the categories in words and the tournaments by name. Reports that are
 * gone are left out of the map.
 */
export async function cvReportDetails(ids: string[]): Promise<
  Map<
    string,
    {
      reporter: { name: string | null; email: string | null };
      categories: string[];
      tournaments: Array<{ id: string; name: string }>;
    }
  >
> {
  if (ids.length === 0) return new Map();
  const reports = await prisma.cvErrorReport.findMany({
    where: { id: { in: [...new Set(ids)] } },
    include: { user: { select: { name: true, email: true } } },
  });
  const tIds = [...new Set(reports.flatMap((r) => r.tournamentIds).filter(isId))];
  const tournaments = tIds.length
    ? await prisma.tournament.findMany({
        where: { id: { in: tIds.map((id) => BigInt(id)) } },
        select: { id: true, name: true },
      })
    : [];
  const nameById = new Map(tournaments.map((t) => [t.id.toString(), t.name]));
  return new Map(
    reports.map((r) => [
      r.id,
      {
        reporter: { name: r.user.name, email: r.user.email },
        categories: r.categories.map(categoryLabel),
        tournaments: r.tournamentIds.map((id) => ({
          id,
          name: nameById.get(id) ?? `Tournament #${id}`,
        })),
      },
    ]),
  );
}
