import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/schema-probe — introspect the live Postgres schema for
 * the tables most likely to be drift-prone (GmailToken in particular).
 *
 * Background: production has two orphan migrations applied that don't
 * exist in the repo (20260428100000_person_disambiguation and
 * 20260512000000_multi_gmail_tokens). The multi_gmail_tokens migration
 * almost certainly added a column or changed a uniqueness constraint on
 * GmailToken that the current Prisma client doesn't write, causing the
 * CREATE branch of `prisma.gmailToken.upsert()` to throw. NextAuth
 * events.signIn swallows that throw; our new syncGmailTokenFromAccount
 * helper catches it and logs at [gmail.sync] failed — but the prisma
 * error message in Vercel's MCP runtime log viewer is truncated, so we
 * still can't see the failing column name.
 *
 * This endpoint hits Postgres's information_schema directly and returns
 * the full column list + unique constraints. Diff against schema.prisma
 * to identify the drift, then either add the column to the Prisma
 * schema (if the migration was intentional) or write a migration to
 * remove it (if it was abandoned work).
 *
 * Admin-gated. Safe to leave deployed — it's read-only and only dumps
 * schema metadata.
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  type ColumnRow = {
    column_name: string;
    data_type: string;
    is_nullable: string;
    column_default: string | null;
  };
  type ConstraintRow = {
    constraint_name: string;
    constraint_type: string;
    column_names: string;
  };
  type AppliedMigrationRow = {
    migration_name: string;
    finished_at: Date | null;
    rolled_back_at: Date | null;
  };

  // Tables we want to introspect. Adding new ones is cheap; we run each
  // probe in parallel and only return the diff-relevant fields.
  const tables = ['GmailToken', 'Account', 'User'] as const;

  const [columnsByTable, constraintsByTable, migrations] = await Promise.all([
    Promise.all(
      tables.map(async (t) => {
        const rows = await prisma.$queryRawUnsafe<ColumnRow[]>(
          `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
           WHERE table_name = $1 AND table_schema = 'public'
           ORDER BY ordinal_position`,
          t,
        );
        return [t, rows] as const;
      }),
    ),
    Promise.all(
      tables.map(async (t) => {
        const rows = await prisma.$queryRawUnsafe<ConstraintRow[]>(
          `SELECT tc.constraint_name,
                  tc.constraint_type,
                  string_agg(kcu.column_name, ',' ORDER BY kcu.ordinal_position) AS column_names
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON tc.constraint_name = kcu.constraint_name
            AND tc.table_schema = kcu.table_schema
           WHERE tc.table_name = $1
             AND tc.table_schema = 'public'
             AND tc.constraint_type IN ('PRIMARY KEY', 'UNIQUE')
           GROUP BY tc.constraint_name, tc.constraint_type
           ORDER BY tc.constraint_type, tc.constraint_name`,
          t,
        );
        return [t, rows] as const;
      }),
    ),
    prisma.$queryRawUnsafe<AppliedMigrationRow[]>(
      `SELECT migration_name, finished_at, rolled_back_at
       FROM _prisma_migrations
       ORDER BY migration_name DESC
       LIMIT 30`,
    ),
  ]);

  return NextResponse.json({
    columns: Object.fromEntries(columnsByTable),
    uniqueConstraints: Object.fromEntries(constraintsByTable),
    recentMigrations: migrations,
  });
}
