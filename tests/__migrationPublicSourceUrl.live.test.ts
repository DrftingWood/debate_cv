/**
 * The 20261026000000_tournament_public_source_url migration, run against a
 * real Postgres on sample rows, must agree with publicTournamentUrl() — the
 * rule every user-facing path already applies — and must be idempotent.
 * Skipped by default; LOCAL database only. It works in a TEMP table, so the
 * database's own rows are never touched.
 *
 *   RUN_MIGRATION_CHECK=1 POSTGRES_PRISMA_URL=<localhost db> \
 *   npx vitest run tests/__migrationPublicSourceUrl.live.test.ts
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { publicTournamentUrl } from '@/lib/cv/publicTournamentUrl';

const DB = process.env.POSTGRES_PRISMA_URL ?? '';
const enabled = process.env.RUN_MIGRATION_CHECK === '1';
if (enabled && !/@(127\.0\.0\.1|localhost|\[::1\])[:/]/.test(DB)) throw new Error('refusing: not localhost');

const SAMPLES = [
  'https://wudc2024.calicotab.com/wudc/privateurls/dvav5u9s/',
  'http://15thiitbombaydebate.calicotab.com/15thiitbombaydebate2023/privateurls/abc123/',
  'https://Edudrift.Calicotab.com/aso-winter2024/privateurls/b4v04b15/',
  'https://presido2026.calicotab.com/privateurls/xyz/',
  'https://wudckorea.herokuapp.com/2021/PrivateUrls/q1w2/',
  // Already public (a pre-scraped row): left exactly as it is.
  'https://sido2026.calicotab.com/sido2026/',
];

describe.runIf(enabled)('migration: Tournament.sourceUrlRaw → public address', () => {
  it('matches publicTournamentUrl on every sample, and a second run changes nothing', async () => {
    const { prisma } = await import('@/lib/db');
    const sql = readFileSync(
      join(process.cwd(), 'prisma/migrations/20261026000000_tournament_public_source_url/migration.sql'),
      'utf8',
    ).replace(/UPDATE "Tournament"/, 'UPDATE "TournamentMigrationCheck"');
    try {
      // One transaction = one connection: a TEMP table is per-connection, and
      // the pool would otherwise be free to run each statement elsewhere.
      const { once, twice } = await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          'CREATE TEMP TABLE "TournamentMigrationCheck" (id serial PRIMARY KEY, "sourceUrlRaw" text NOT NULL, "updatedAt" timestamp) ON COMMIT DROP',
        );
        for (const s of SAMPLES) {
          await tx.$executeRawUnsafe('INSERT INTO "TournamentMigrationCheck" ("sourceUrlRaw") VALUES ($1)', s);
        }
        const read = () =>
          tx.$queryRawUnsafe<Array<{ sourceUrlRaw: string }>>('SELECT "sourceUrlRaw" FROM "TournamentMigrationCheck" ORDER BY id');
        await tx.$executeRawUnsafe(sql);
        const first = await read();
        await tx.$executeRawUnsafe(sql);
        return { once: first, twice: await read() };
      });
      SAMPLES.forEach((s, i) => {
        const got = once[i]!.sourceUrlRaw;
        // The helper lowercases the host via URL.origin; SQL keeps the case it
        // was stored in. Host comparison is case-insensitive everywhere.
        expect(got.toLowerCase()).toBe(publicTournamentUrl(s).toLowerCase());
        expect(got.toLowerCase()).not.toContain('privateurls');
      });
      expect(twice).toEqual(once);
      expect(once[SAMPLES.length - 1]!.sourceUrlRaw).toBe(SAMPLES[SAMPLES.length - 1]);
    } finally {
      await prisma.$disconnect();
    }
  });
});
