/**
 * The review set's vocabulary and its order, apart from its database code
 * (lib/admin/reviewSet.ts) so the client components that show and edit
 * flags can import it without pulling Prisma into the browser bundle.
 */

export const PRIORITIES = ['high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_LABEL: Record<Priority, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const SOURCES = ['import', 'cv_report', 'parser_warning', 'audit_check'] as const;
export type FlagSource = (typeof SOURCES)[number];

export const FLAG_STATUSES = ['open', 'done'] as const;
export type FlagStatus = (typeof FLAG_STATUSES)[number];

import { CHECK_LABELS } from '@/lib/audit/types';

export const COMMENT_MAX = 1000;

/**
 * An accuracy check's flag id: `<tournamentId>:<check code>`, the same shape
 * as the check's mark subject. Digits only for the id (BigInt() alone would
 * accept '0x10') and a known code, so a typo cannot store a flag nothing
 * will ever describe. Null for anything else.
 */
export function parseAuditCheckId(id: string): { tournamentId: string; code: string } | null {
  const m = /^(\d{1,18}):([a-z_]+)$/.exec(id);
  if (!m || !m[1] || !m[2] || !Object.hasOwn(CHECK_LABELS, m[2])) return null;
  return { tournamentId: m[1], code: m[2] };
}

export type FlagItem = { source: FlagSource; sourceId: string };

const RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * High, then medium, then low; within a priority by when it was flagged.
 * The ledger reads oldest first (what has waited longest); the export reads
 * newest first (what was just noticed), as the brief asks.
 */
export function sortFlags<T extends { priority: string; createdAt: Date }>(
  flags: readonly T[],
  order: 'oldest' | 'newest',
): T[] {
  const dir = order === 'oldest' ? 1 : -1;
  return [...flags].sort(
    (a, b) =>
      (RANK[a.priority] ?? 3) - (RANK[b.priority] ?? 3) ||
      dir * (a.createdAt.getTime() - b.createdAt.getTime()),
  );
}
