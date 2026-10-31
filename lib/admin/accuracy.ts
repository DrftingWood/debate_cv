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
 * that, the counts move into SQL.
 */

/** Tournaments listed under each open question. */
const QUESTION_LIST_CAP = 50;
/** An audit older than this is counted as not audited (run.ts's STALE_MS). */
const STALE_MS = 24 * 60 * 60 * 1000;

export type Band = ReturnType<typeof band>;

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
  /**
   * The same per check for warnings that are not failing. Some checks only
   * ever warn (an adjudication core no page names), so a failing count alone
   * would read zero for them.
   */
  warningByCheck: Array<{ code: CheckCode; label: string; count: number }>;
  /** Audited tournaments with at least one check marked checked (the "Checked" chip). */
  checked: number;
  /** Tournaments never audited or last audited over 24 h ago. */
  stale: number;
  /** Every tournament, audited or not: the denominator of `stale`. */
  tournaments: number;
  /** Tournaments an admin set to ignored; not counted anywhere above. */
  ignored: number;
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
  /** What the check said before the mark made it a pass. */
  wasStatus?: 'fail' | 'warn';
};

const STATUSES: readonly string[] = ['pass', 'warn', 'fail', 'na'];
const KINDS: readonly string[] = [
  'team',
  'speaker',
  'participants',
  'motions',
  'home',
  'break',
  'round',
];

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
 * A stored mark (run.ts's applyMark), only when every part is readable: a
 * name without a date, a date that does not parse, or an unknown former
 * status drops the mark whole.
 */
function parseMark(
  c: Record<string, unknown>,
): Pick<ParsedCheck, 'checkedBy' | 'checkedAt' | 'wasStatus'> {
  if (typeof c.checkedBy !== 'string' || !c.checkedBy || typeof c.checkedAt !== 'string') return {};
  if (c.wasStatus !== 'fail' && c.wasStatus !== 'warn') return {};
  const at = new Date(c.checkedAt);
  if (Number.isNaN(at.getTime())) return {};
  return { checkedBy: c.checkedBy, checkedAt: at, wasStatus: c.wasStatus };
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
export const isFailing = (c: ParsedCheck) =>
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

/** A warning that is not failing (open user reports fail; isFailing). */
export const isWarning = (c: ParsedCheck) => c.status === 'warn' && !isFailing(c);

function countChecks(
  audits: Audit[],
  counted: (c: ParsedCheck) => boolean,
): AccuracyOverview['failingByCheck'] {
  const counts = new Map<CheckCode, number>();
  for (const a of audits) {
    // A tournament counts once per check, however its JSON repeats it.
    for (const code of new Set(a.checks.filter(counted).map((c) => c.code))) {
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

/** Each unsettled rule with how many audits it decided and the lowest-scoring few. */
function openQuestionsOf(
  questions: Map<AssumptionCode, Audit[]>,
  describe: (id: bigint) => { name: string; tabUrl: string | null; scrapedAt: Date | null },
): OpenQuestion[] {
  return [...questions].map(([code, list]) => ({
    code,
    ...ASSUMPTIONS[code],
    count: list.length,
    tournaments: list
      .slice(0, QUESTION_LIST_CAP)
      .map((a) => ({ id: a.id.toString(), ...describe(a.id) })),
  }));
}

/** Audits with at least one check an admin has vouched for. */
const countChecked = (audits: Audit[]) =>
  audits.filter((a) => a.checks.some((c) => c.checkedBy)).length;

export async function getAccuracyOverview(): Promise<AccuracyOverview> {
  // Test and demo tournaments an admin set to ignored are left out of the
  // score, the bands, the counts and the open questions; `ignored` says how
  // many there are, for the Tournaments tab's chip.
  const live = { tournament: { ignored: false } };
  const [rows, tournaments, ignored] = await Promise.all([
    prisma.tournamentAudit.findMany({
      where: live,
      select: {
        tournamentId: true,
        score: true,
        usersAffected: true,
        computedAt: true,
        checks: true,
      },
    }),
    prisma.tournament.count({ where: { ignored: false } }),
    prisma.tournament.count({ where: { ignored: true } }),
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

  const questions = decidedBy(audits);
  const listed = [...questions.values()].flatMap((list) => list.slice(0, QUESTION_LIST_CAP));
  const names = await namesFor([...new Set(listed.map((a) => a.id))]);
  const describe = (id: bigint) =>
    names.get(id) ?? { name: `Tournament ${id}`, tabUrl: null, scrapedAt: null };

  return {
    ...databaseScore(audits),
    onCvs: audits.filter((a) => a.usersAffected > 0).length,
    bands,
    failingByCheck: countChecks(audits, isFailing),
    warningByCheck: countChecks(audits, isWarning),
    checked: countChecked(audits),
    stale: Math.max(0, tournaments - fresh),
    tournaments,
    ignored,
    openQuestions: openQuestionsOf(questions, describe),
  };
}
