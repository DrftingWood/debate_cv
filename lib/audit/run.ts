import * as Sentry from '@sentry/nextjs';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { PARSER_VERSION } from '@/lib/calicotab/version';
import { fingerprintOf, marksFor, type Mark } from '@/lib/admin/adminChecks';
import { CHECKS_VERSION, runChecks } from './checks';
import { loadAuditInputs } from './load';
import { scoreTournament } from './score';
import type { CheckResult } from './types';

/**
 * Computing and storing tournament audits, and the three ways they run
 * (spec, "When it runs"): after every successful scrape write
 * (auditAfterScrape), a bounded sweep of missing and stale audits in the cron
 * (auditStale), and the admin's "Audit now" (both, through
 * POST /api/admin/audit).
 */

/** Tournaments loaded and written per step of a sweep. */
const CHUNK = 25;
/** An audit older than this is re-run: the data may have changed under it. */
const STALE_MS = 24 * 60 * 60 * 1000;

/**
 * The stored form of a tournament's check results. Spelled out field by field,
 * not cast, so the JSON column holds exactly what parseChecks reads back, and
 * an optional field reaches it as an empty list rather than as undefined
 * (which a JSON value cannot hold).
 */
function checksJson(checks: CheckResult[]): Prisma.InputJsonArray {
  return checks.map((c) => ({
    code: c.code,
    status: c.status,
    detail: c.detail,
    pieces: c.pieces.map((p) => ({ kind: p.kind, key: p.key, label: p.label, url: p.url })),
    assumptions: c.assumptions ?? [],
    // Only on a checked check: a JSON value cannot hold undefined, and an
    // absent key reads back as "not checked" (parseChecks).
    ...(c.checkedBy != null && c.checkedAt != null && c.wasStatus != null
      ? { checkedBy: c.checkedBy, checkedAt: c.checkedAt, wasStatus: c.wasStatus }
      : {}),
  }));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "31 Oct 2026", in UTC. Spelled out rather than through Intl, whose short
 * month names differ between ICU versions ("Sep" against "Sept"), and this
 * sentence is stored.
 */
function shortDate(d: Date): string {
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** The part of an admin's email before the @: a name, without the address. */
const nameOf = (email: string) => email.split('@')[0] || email;

/** The subject an AdminCheck mark of one tournament check is stored under. */
export const checkSubject = (tournamentId: bigint, code: string) => `${tournamentId}:${code}`;

/**
 * A check whose mark still matches what it says now becomes a pass, before
 * scoring, so the admin's "the data is right" raises the score. The old
 * finding stays in the detail, because the tables show what was vouched for.
 * A mark whose fingerprint differs is about data that has since changed, so
 * it is ignored and the check counts as it stands.
 */
function applyMark(check: CheckResult, mark: Mark | undefined): CheckResult {
  if (!mark || (check.status !== 'fail' && check.status !== 'warn')) return check;
  if (mark.fingerprint !== fingerprintOf('check', check)) return check;
  return {
    ...check,
    status: 'pass',
    detail: `Checked by ${nameOf(mark.checkedBy)} on ${shortDate(mark.checkedAt)}. Was: ${check.detail}`,
    checkedBy: mark.checkedBy,
    checkedAt: mark.checkedAt.toISOString(),
    // Kept so the tables can tell a vouched-for fail from a vouched-for warn.
    wasStatus: check.status,
  };
}

/**
 * Loads, checks, scores and stores the audit of each tournament, returning
 * how many were written. Ids with no Tournament row are skipped. The upserts
 * share one transaction so a batch is stored whole or not at all.
 */
export async function runAudit(tournamentIds: bigint[]): Promise<number> {
  return (await runAuditReport(tournamentIds)).audited;
}

export type AuditReport = {
  /** Audits written. */
  audited: number;
  /**
   * Subjects (`<tournamentId>:<code>`) whose mark took effect: its
   * fingerprint matched, so the check was scored as a pass. "Mark checked"
   * compares this with what it just marked, so the page can say when a mark
   * was saved but the data had already changed.
   */
  applied: Set<string>;
};

/** runAudit, also naming the marks that took effect. */
export async function runAuditReport(tournamentIds: bigint[]): Promise<AuditReport> {
  const applied = new Set<string>();
  if (tournamentIds.length === 0) return { audited: 0, applied };
  const loaded = await loadAuditInputs(tournamentIds);
  const computedAt = new Date();
  const raw = [...loaded].map(([tournamentId, inputs]) => ({
    tournamentId,
    inputs,
    checks: runChecks(inputs, PARSER_VERSION),
  }));
  // One read for the whole batch, and only of checks a mark could change.
  const marks = await marksFor(
    'check',
    raw.flatMap(({ tournamentId, checks }) =>
      checks
        .filter((c) => c.status === 'fail' || c.status === 'warn')
        .map((c) => checkSubject(tournamentId, c.code)),
    ),
  );
  const writes = raw.map(({ tournamentId, inputs, checks: found }) => {
    const checks = found.map((c) => {
      const subject = checkSubject(tournamentId, c.code);
      const out = applyMark(c, marks.get(subject));
      if (out !== c) applied.add(subject);
      return out;
    });
    const data = {
      score: scoreTournament(checks, inputs.openReports.length),
      checks: checksJson(checks),
      usersAffected: inputs.usersAffected,
      checksVersion: CHECKS_VERSION,
      computedAt,
    };
    return prisma.tournamentAudit.upsert({
      where: { tournamentId },
      create: { tournamentId, ...data },
      update: data,
    });
  });
  if (writes.length > 0) await prisma.$transaction(writes);
  return { audited: writes.length, applied };
}

/**
 * Tournaments due an audit, most overdue first: never audited, then audits
 * older than a day or computed under an older CHECKS_VERSION, oldest first.
 * Two indexed queries rather than one ordered join, because "never audited"
 * has no computedAt to sort on.
 */
async function dueTournaments(limit: number): Promise<bigint[]> {
  const missing = await prisma.tournament.findMany({
    where: { audit: { is: null } },
    orderBy: { id: 'asc' },
    take: limit,
    select: { id: true },
  });
  const ids = missing.map((t) => t.id);
  if (ids.length >= limit) return ids;
  const stale = await prisma.tournamentAudit.findMany({
    where: {
      OR: [
        { computedAt: { lt: new Date(Date.now() - STALE_MS) } },
        { checksVersion: { not: CHECKS_VERSION } },
      ],
    },
    orderBy: { computedAt: 'asc' },
    take: limit - ids.length,
    select: { tournamentId: true },
  });
  return [...ids, ...stale.map((a) => a.tournamentId)];
}

/**
 * Audits up to `limit` due tournaments in chunks of CHUNK, starting no chunk
 * once `deadline` (epoch ms) has passed. A chunk is a few grouped queries and
 * one write transaction, well inside the seconds a caller keeps between its
 * deadline and the platform's kill. Returns how many were audited; a
 * tournament whose audit throws is skipped, not counted.
 */
export async function auditStale(opts: { limit: number; deadline: number }): Promise<number> {
  const ids = await dueTournaments(opts.limit);
  let audited = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    if (Date.now() >= opts.deadline) break;
    audited += await auditChunk(ids.slice(i, i + CHUNK), opts.deadline);
  }
  return audited;
}

/**
 * One chunk, falling back to one tournament at a time if the chunk throws.
 * Without the fallback one tournament whose data breaks the load, a check or
 * its write would fail the whole sweep, and since the next tick picks the
 * same tournaments in the same order, every sweep after it would die at the
 * same chunk. Now only that tournament is skipped (and logged); it stays due,
 * so it is tried again next tick without holding the others back. The
 * one-by-one retries honour the sweep's deadline too.
 */
async function auditChunk(ids: bigint[], deadline: number): Promise<number> {
  try {
    return await runAudit(ids);
  } catch {
    let audited = 0;
    for (const id of ids) {
      if (Date.now() >= deadline) break;
      try {
        audited += await runAudit([id]);
      } catch (err) {
        console.error('[audit] tournament audit failed', {
          tournamentId: String(id),
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return audited;
  }
}

/**
 * The audit after a scrape write. Best-effort: the scrape has already
 * committed, so an audit failure is logged and reported, never thrown into
 * the ingest. A tournament whose audit failed here is still caught by the
 * cron's sweep, since its audit stays missing or stale.
 */
export async function auditAfterScrape(tournamentId: bigint): Promise<void> {
  try {
    await runAudit([tournamentId]);
  } catch (err) {
    console.error('[audit] after-scrape audit failed', {
      tournamentId: String(tournamentId),
      error: err instanceof Error ? err.message : String(err),
    });
    Sentry.captureException(err, {
      tags: { stage: 'audit-after-scrape' },
      extra: { tournamentId: String(tournamentId) },
    });
  }
}
