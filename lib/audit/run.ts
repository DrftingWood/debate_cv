import * as Sentry from '@sentry/nextjs';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { PARSER_VERSION } from '@/lib/calicotab/version';
import { CHECKS_VERSION, runChecks } from './checks';
import { loadAuditInputs } from './load';
import { scoreTournament } from './score';

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
 * Loads, checks, scores and stores the audit of each tournament, returning
 * how many were written. Ids with no Tournament row are skipped. The upserts
 * share one transaction so a batch is stored whole or not at all.
 */
export async function runAudit(tournamentIds: bigint[]): Promise<number> {
  if (tournamentIds.length === 0) return 0;
  const loaded = await loadAuditInputs(tournamentIds);
  const computedAt = new Date();
  const writes = [...loaded].map(([tournamentId, inputs]) => {
    const checks = runChecks(inputs, PARSER_VERSION);
    const data = {
      score: scoreTournament(checks, inputs.openReports.length),
      checks: checks as unknown as Prisma.InputJsonValue,
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
  return writes.length;
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
 * deadline and the platform's kill. Returns how many were audited.
 */
export async function auditStale(opts: { limit: number; deadline: number }): Promise<number> {
  const ids = await dueTournaments(opts.limit);
  let audited = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    if (Date.now() >= opts.deadline) break;
    audited += await runAudit(ids.slice(i, i + CHUNK));
  }
  return audited;
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
