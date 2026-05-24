import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Allowlist of migration names that are safe to delete from
 * `_prisma_migrations`. Both rows are applied in production
 * (finished_at set, rolled_back_at null) but have no corresponding
 * file in `prisma/migrations/` — they were committed and abandoned
 * elsewhere. Their schema effects are either already reversed (see
 * 20260524130000_restore_gmailtoken_constraints) or cosmetic.
 *
 * The allowlist exists so this endpoint can't be coerced into
 * deleting a real, load-bearing migration row by an attacker who
 * somehow bypassed the admin gate — the route is admin-gated, but
 * defence in depth is cheap when the call site is fixed.
 *
 * Extending the list requires a code change + redeploy. Good. New
 * orphans are rare and each one deserves a code-review eye.
 */
const KNOWN_ORPHANS = new Set([
  '20260428100000_person_disambiguation',
  '20260512000000_multi_gmail_tokens',
]);

/**
 * POST /api/admin/migrations/clear-orphans
 *
 * Body: { migrationNames: string[] }  — must be a subset of KNOWN_ORPHANS.
 *
 * Returns: { deleted: number, migrationNames: string[], rejected: string[] }
 *
 * Why DELETE and not `prisma migrate resolve --rolled-back`: rolled-back
 * still leaves the row in _prisma_migrations with rolled_back_at set,
 * which `prisma migrate status` keeps reporting as drift ("recorded but
 * no file in folder"). DELETE removes the row entirely so status reads
 * clean. The orphan files will never reappear; nothing in deploy logic
 * cares about a row that isn't there. (Equivalent to what the
 * prisma-resolve GH Actions workflow would do, except direct — avoids
 * needing the gh CLI from this environment.)
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  const body = (await req.json().catch(() => ({}))) as { migrationNames?: unknown };
  const requested = Array.isArray(body.migrationNames) ? body.migrationNames : [];

  const valid: string[] = [];
  const rejected: string[] = [];
  for (const n of requested) {
    if (typeof n === 'string' && KNOWN_ORPHANS.has(n)) valid.push(n);
    else rejected.push(String(n));
  }

  if (valid.length === 0) {
    return NextResponse.json(
      {
        error: 'no_valid_migrations',
        hint: 'migrationNames must be a subset of the allowlist',
        allowed: Array.from(KNOWN_ORPHANS),
        rejected,
      },
      { status: 400 },
    );
  }

  let deleted = 0;
  for (const name of valid) {
    deleted += await prisma.$executeRaw`DELETE FROM _prisma_migrations WHERE migration_name = ${name}`;
  }

  return NextResponse.json({
    deleted,
    migrationNames: valid,
    ...(rejected.length ? { rejected } : {}),
  });
}
