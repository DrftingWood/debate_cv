import { prisma } from '@/lib/db';
import { band } from '@/lib/audit/score';
import { ASSUMPTIONS, CHECK_LABELS, type CheckCode, type CheckStatus } from '@/lib/audit/types';
import { CHECKS_VERSION } from '@/lib/audit/checks';
import { parseChecks, suggestedPieces, type Band } from '@/lib/admin/accuracy';
import type { SuggestedPiece } from '@/lib/admin/accuracyActions';

/**
 * Read model for the "Accuracy checks" panel on /admin/tournaments/[id]:
 * the one stored audit of this tournament, every check in it, and the
 * pieces a re-scrape should fetch. Design:
 * docs/superpowers/specs/2026-10-31-data-accuracy-design.md, "Admin view".
 *
 * Everything here is what the page may hand to the browser: parseChecks
 * makes each piece URL public again whatever was stored, so no private key
 * can ride along in a prop.
 */

export type CheckView = {
  code: CheckCode;
  label: string;
  status: CheckStatus;
  detail: string;
  pieces: SuggestedPiece[];
  /** Unsettled rules that decided this result, titled for the "Open question" note. */
  questions: Array<{ code: string; title: string }>;
};

export type TournamentAccuracy = {
  score: number;
  band: Band;
  computedAt: Date;
  /** Written by an older CHECKS_VERSION: its rows may lack newer checks. */
  outdated: boolean;
  checks: CheckView[];
  /** Pieces of failing and warning checks: what "Select suggested" ticks. */
  suggested: SuggestedPiece[];
};

/** The stored audit, or null when this tournament has not been audited. */
export async function getTournamentAccuracy(id: bigint): Promise<TournamentAccuracy | null> {
  const row = await prisma.tournamentAudit.findUnique({
    where: { tournamentId: id },
    select: { score: true, computedAt: true, checks: true, checksVersion: true },
  });
  if (!row) return null;
  const checks = parseChecks(row.checks);
  return {
    score: row.score,
    band: band(row.score),
    computedAt: row.computedAt,
    outdated: row.checksVersion !== CHECKS_VERSION,
    checks: checks.map((c) => ({
      code: c.code,
      label: CHECK_LABELS[c.code],
      status: c.status,
      detail: c.detail,
      pieces: c.pieces,
      questions: c.assumptions.map((a) => ({ code: a, title: ASSUMPTIONS[a].title })),
    })),
    suggested: suggestedPieces(checks),
  };
}
