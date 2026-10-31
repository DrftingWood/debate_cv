import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * "Mark checked" (owner, 2026-10-31: "if i am supposed check something, i
 * should be able to mark it"). A mark says "I looked at this and the data is
 * right": the item leaves the inbox and, for a tournament check, the check
 * counts as a pass in the score (lib/audit/run.ts). Design:
 * docs/superpowers/specs/2026-10-31-admin-redesign-design.md, "Mark checked".
 *
 * A mark carries a fingerprint of what the admin saw. When the data changes
 * (a re-scrape rewrites the check's finding, an import fails a different
 * way, a parser warning grows into a new bucket) the fingerprint no longer
 * matches and the mark is ignored, so the item comes back instead of a stale
 * "checked" hiding a new problem.
 *
 * Read and written through raw SQL rather than the generated client, so this
 * works whether or not the client in use was generated after AdminCheck was
 * added (the same reason as lib/calicotab/redactedCounts.ts). Every value is
 * a bound parameter of a Prisma.sql template, never spliced into the text.
 */

export type MarkKind = 'check' | 'report' | 'import' | 'parser';

export const MARK_KINDS = [
  'check',
  'report',
  'import',
  'parser',
] as const satisfies readonly MarkKind[];

/** Longest note the API accepts on a mark. */
export const NOTE_MAX = 500;

/** What each kind's fingerprint is taken over. */
export type FingerprintPayload = {
  check: { status: string; detail: string };
  import: { errorCategory: string; attempts: number };
  parser: { count: number };
  report: { status: string };
};

/**
 * Parser warnings recur on every scrape, so their raw count moves all the
 * time; only a jump into a new bucket counts as "changed".
 */
function countBucket(count: number): string {
  if (count <= 1) return '1';
  if (count <= 5) return '2-5';
  if (count <= 20) return '6-20';
  return '21+';
}

/**
 * The text each kind hashes. A table keyed by kind rather than a switch, so
 * TypeScript pairs each kind with its own payload shape without casts.
 */
const SOURCE: { [K in MarkKind]: (p: FingerprintPayload[K]) => string } = {
  check: (p) => `${p.status}|${p.detail}`,
  import: (p) => `${p.errorCategory}|${p.attempts}`,
  parser: (p) => countBucket(p.count),
  report: (p) => p.status,
};

/** A stable short hash (sha1 hex, first 16 characters) of what was checked. */
export function fingerprintOf<K extends MarkKind>(kind: K, payload: FingerprintPayload[K]): string {
  const source: (p: FingerprintPayload[K]) => string = SOURCE[kind];
  return createHash('sha1').update(source(payload)).digest('hex').slice(0, 16);
}

export type MarkInput = {
  kind: MarkKind;
  subject: string;
  fingerprint: string;
  note?: string | null;
  /** The admin's email. */
  by: string;
};

export type Mark = {
  fingerprint: string;
  checkedBy: string;
  checkedAt: Date;
  note: string | null;
};

/**
 * One upsert. Marking again (say after a re-scrape brought the item back)
 * replaces the fingerprint, note, author and time, because the new mark is
 * about the data as it is now.
 */
function upsertSql(m: MarkInput): Prisma.Sql {
  return Prisma.sql`
    INSERT INTO "AdminCheck" ("kind", "subject", "fingerprint", "note", "checkedBy")
    VALUES (${m.kind}, ${m.subject}, ${m.fingerprint}, ${m.note ?? null}, ${m.by})
    ON CONFLICT ("kind", "subject") DO UPDATE SET
      "fingerprint" = EXCLUDED."fingerprint",
      "note" = EXCLUDED."note",
      "checkedBy" = EXCLUDED."checkedBy",
      "checkedAt" = CURRENT_TIMESTAMP`;
}

export async function markChecked(m: MarkInput): Promise<void> {
  await prisma.$executeRaw(upsertSql(m));
}

/** Several marks at once (the inbox's bulk "Mark checked"), stored whole or not at all. */
export async function markAllChecked(marks: MarkInput[]): Promise<number> {
  if (marks.length === 0) return 0;
  await prisma.$transaction(marks.map((m) => prisma.$executeRaw(upsertSql(m))));
  return marks.length;
}

export async function undoMark(kind: MarkKind, subject: string): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM "AdminCheck" WHERE "kind" = ${kind} AND "subject" = ${subject}`);
}

type MarkRow = Mark & { subject: string };

/**
 * The marks of the given subjects of one kind, keyed by subject. Whether a
 * mark still holds (its fingerprint matches) is the caller's question: only
 * the caller knows what the item says now.
 */
export async function marksFor(kind: MarkKind, subjects: string[]): Promise<Map<string, Mark>> {
  const out = new Map<string, Mark>();
  if (subjects.length === 0) return out;
  const rows = await prisma.$queryRaw<MarkRow[]>(Prisma.sql`
    SELECT "subject", "fingerprint", "checkedBy", "checkedAt", "note"
    FROM "AdminCheck"
    WHERE "kind" = ${kind} AND "subject" IN (${Prisma.join(subjects)})`);
  for (const r of rows) {
    out.set(r.subject, {
      fingerprint: r.fingerprint,
      checkedBy: r.checkedBy,
      checkedAt: r.checkedAt,
      note: r.note,
    });
  }
  return out;
}
