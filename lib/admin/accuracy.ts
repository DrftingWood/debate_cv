import { prisma } from '@/lib/db';
import { band, databaseScore } from '@/lib/audit/score';
import {
  ASSUMPTIONS,
  CHECK_LABELS,
  publicPieceUrl,
  type AssumptionCode,
  type CheckCode,
  type CheckStatus,
} from '@/lib/audit/types';
import type { PieceKind } from '@/lib/calicotab/scrapePieces';
import { RESCRAPE_PIECE_CAP, type SuggestedPiece } from '@/lib/admin/accuracyActions';

/**
 * Read model for the admin overview's "Data accuracy" section. Design:
 * docs/superpowers/specs/2026-10-31-data-accuracy-design.md, "Admin view".
 *
 * Every stored audit is read once, with its checks, and everything else is
 * worked out here: the database score needs every row's score anyway, and
 * the counts per failing check and per open question need every row's
 * checks. Reading the JSON here rather than in SQL lets one defensive parser
 * (parseChecks) decide what a stored check means, so a row written by an
 * older or newer CHECKS_VERSION can never break the page. A few thousand
 * audits of a few KB each is fine for an admin page; if the table grows past
 * that, the counts move into SQL and only the 200 lowest keep their checks.
 */

/** Rows in the ledger table, lowest score first. */
const LOWEST_CAP = 200;
/** Tournaments listed under each open question. */
const QUESTION_LIST_CAP = 50;
/** An audit older than this is counted as not audited (run.ts's STALE_MS). */
const STALE_MS = 24 * 60 * 60 * 1000;

export type Band = ReturnType<typeof band>;

export type AccuracyRow = {
  id: string;
  name: string;
  /** The tournament's public tab, never a private URL; null when unparseable. */
  tabUrl: string | null;
  /** When the tournament was last scraped, for the "In database" cell. */
  scrapedAt: Date | null;
  score: number;
  band: Band;
  failed: Array<{ code: CheckCode; label: string }>;
  /** Pieces of failing and warning checks, deduplicated, at most 40. */
  suggested: SuggestedPiece[];
  usersAffected: number;
  computedAt: Date;
};

export type OpenQuestion = {
  code: AssumptionCode;
  title: string;
  rule: string;
  status: string;
  /** Audited tournaments whose result this rule decided. */
  count: number;
  tournaments: Array<{ id: string; name: string; tabUrl: string | null; scrapedAt: Date | null }>;
};

export type AccuracyOverview = {
  weighted: number | null;
  unweighted: number | null;
  n: number;
  /** Audited tournaments on at least one user's CV. */
  onCvs: number;
  bands: Record<Band, number>;
  failingByCheck: Array<{ code: CheckCode; label: string; count: number }>;
  /** Tournaments never audited or last audited over 24 h ago. */
  stale: number;
  /** Every tournament, audited or not: the denominator of `stale`. */
  tournaments: number;
  lowest: AccuracyRow[];
  openQuestions: OpenQuestion[];
};

export type ParsedCheck = {
  code: CheckCode;
  status: CheckStatus;
  /** The one-sentence finding; empty when the stored row has none. */
  detail: string;
  pieces: SuggestedPiece[];
  assumptions: AssumptionCode[];
  /** Who marked the check checked and when, if the audit applied a mark. */
  checkedBy?: string;
  checkedAt?: Date;
};

const STATUSES: readonly string[] = ['pass', 'warn', 'fail', 'na'];
const KINDS: readonly string[] = ['team', 'speaker', 'participants', 'motions', 'break', 'round'];

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const has = <T extends string>(map: Record<T, unknown>, k: unknown): k is T =>
  typeof k === 'string' && Object.prototype.hasOwnProperty.call(map, k);

function parsePiece(v: unknown): SuggestedPiece | null {
  if (!isObject(v) || typeof v.kind !== 'string' || !KINDS.includes(v.kind)) return null;
  if (typeof v.key !== 'string') return null;
  const label = typeof v.label === 'string' && v.label ? v.label : v.key || v.kind;
  // Made public again on the way out, whatever was stored: a private key in
  // an href is someone's identity.
  const url = typeof v.url === 'string' ? publicPieceUrl(v.url) : null;
  return { kind: v.kind as PieceKind, key: v.key, label, url };
}

/**
 * A stored mark (run.ts's applyMark), only when both halves are readable:
 * a name without a date, or a date that does not parse, is dropped whole.
 */
function parseMark(c: Record<string, unknown>): { checkedBy?: string; checkedAt?: Date } {
  if (typeof c.checkedBy !== 'string' || !c.checkedBy || typeof c.checkedAt !== 'string') return {};
  const at = new Date(c.checkedAt);
  return Number.isNaN(at.getTime()) ? {} : { checkedBy: c.checkedBy, checkedAt: at };
}

/**
 * The stored `checks` JSON as far as it can be read. Anything that is not a
 * known check with a known status is dropped, as are unreadable pieces and
 * unknown assumption codes; a missing `assumptions` reads as none.
 */
export function parseChecks(json: unknown): ParsedCheck[] {
  if (!Array.isArray(json)) return [];
  const out: ParsedCheck[] = [];
  for (const c of json) {
    if (!isObject(c) || !has(CHECK_LABELS, c.code)) continue;
    if (typeof c.status !== 'string' || !STATUSES.includes(c.status)) continue;
    const pieces = Array.isArray(c.pieces) ? c.pieces.map(parsePiece) : [];
    const assumptions = Array.isArray(c.assumptions)
      ? c.assumptions.filter((a): a is AssumptionCode => has(ASSUMPTIONS, a))
      : [];
    out.push({
      code: c.code,
      status: c.status as CheckStatus,
      detail: typeof c.detail === 'string' ? c.detail : '',
      pieces: pieces.filter((p): p is SuggestedPiece => p != null),
      assumptions,
      ...parseMark(c),
    });
  }
  return out;
}

/**
 * A check that counts as failing on the overview: a `fail`, or open user
 * reports (user_reports has no fail status; a person saying "this is wrong"
 * is the strongest hint there is).
 */
const isFailing = (c: ParsedCheck) =>
  c.status === 'fail' || (c.code === 'user_reports' && c.status === 'warn');

/** Union of failing and warning pieces, first seen first, capped at the route's limit. */
export function suggestedPieces(checks: ParsedCheck[]): SuggestedPiece[] {
  const seen = new Set<string>();
  const out: SuggestedPiece[] = [];
  for (const c of checks) {
    if (c.status !== 'fail' && c.status !== 'warn') continue;
    for (const p of c.pieces) {
      const k = `${p.kind}:${p.key}`;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
  }
  return out.slice(0, RESCRAPE_PIECE_CAP);
}

type Audit = {
  id: bigint;
  score: number;
  usersAffected: number;
  computedAt: Date;
  checks: ParsedCheck[];
};

/** Lowest score first; among equals, the one on more CVs, then the older id. */
const byScore = (a: Audit, b: Audit) =>
  a.score - b.score || b.usersAffected - a.usersAffected || (a.id < b.id ? -1 : 1);

async function namesFor(ids: bigint[]) {
  type Named = { name: string; tabUrl: string | null; scrapedAt: Date | null };
  if (ids.length === 0) return new Map<bigint, Named>();
  const rows = await prisma.tournament.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, sourceUrlRaw: true, scrapedAt: true },
  });
  return new Map(
    rows.map(
      (t) =>
        [
          t.id,
          { name: t.name, tabUrl: publicPieceUrl(t.sourceUrlRaw), scrapedAt: t.scrapedAt },
        ] as const,
    ),
  );
}

function countFailing(audits: Audit[]): AccuracyOverview['failingByCheck'] {
  const counts = new Map<CheckCode, number>();
  for (const a of audits) {
    // A tournament counts once per check, however its JSON repeats it.
    for (const code of new Set(a.checks.filter(isFailing).map((c) => c.code))) {
      counts.set(code, (counts.get(code) ?? 0) + 1);
    }
  }
  return [...counts]
    .map(([code, count]) => ({ code, label: CHECK_LABELS[code], count }))
    .sort((x, y) => y.count - x.count || x.label.localeCompare(y.label));
}

function decidedBy(audits: Audit[]): Map<AssumptionCode, Audit[]> {
  const out = new Map<AssumptionCode, Audit[]>();
  for (const code of Object.keys(ASSUMPTIONS) as AssumptionCode[]) {
    out.set(
      code,
      audits.filter((a) => a.checks.some((c) => c.assumptions.includes(code))).sort(byScore),
    );
  }
  return out;
}

export async function getAccuracyOverview(): Promise<AccuracyOverview> {
  const [rows, tournaments] = await Promise.all([
    prisma.tournamentAudit.findMany({
      select: {
        tournamentId: true,
        score: true,
        usersAffected: true,
        computedAt: true,
        checks: true,
      },
    }),
    prisma.tournament.count(),
  ]);
  const audits: Audit[] = rows.map((r) => ({
    id: r.tournamentId,
    score: r.score,
    usersAffected: r.usersAffected,
    computedAt: r.computedAt,
    checks: parseChecks(r.checks),
  }));

  const freshSince = Date.now() - STALE_MS;
  const fresh = audits.filter((a) => a.computedAt.getTime() >= freshSince).length;
  const bands: Record<Band, number> = { good: 0, check: 0, rescrape: 0 };
  for (const a of audits) bands[band(a.score)] += 1;

  const lowest = [...audits].sort(byScore).slice(0, LOWEST_CAP);
  const questions = decidedBy(audits);
  const listed = [...questions.values()].flatMap((list) => list.slice(0, QUESTION_LIST_CAP));
  const names = await namesFor([...new Set([...lowest, ...listed].map((a) => a.id))]);
  const describe = (id: bigint) =>
    names.get(id) ?? { name: `Tournament ${id}`, tabUrl: null, scrapedAt: null };

  return {
    ...databaseScore(audits),
    onCvs: audits.filter((a) => a.usersAffected > 0).length,
    bands,
    failingByCheck: countFailing(audits),
    stale: Math.max(0, tournaments - fresh),
    tournaments,
    lowest: lowest.map((a) => ({
      id: a.id.toString(),
      ...describe(a.id),
      score: a.score,
      band: band(a.score),
      failed: [...new Set(a.checks.filter(isFailing).map((c) => c.code))].map((code) => ({
        code,
        label: CHECK_LABELS[code],
      })),
      suggested: suggestedPieces(a.checks),
      usersAffected: a.usersAffected,
      computedAt: a.computedAt,
    })),
    openQuestions: [...questions].map(([code, list]) => ({
      code,
      ...ASSUMPTIONS[code],
      count: list.length,
      tournaments: list
        .slice(0, QUESTION_LIST_CAP)
        .map((a) => ({ id: a.id.toString(), ...describe(a.id) })),
    })),
  };
}
