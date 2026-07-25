-- Cleanup after the reverted 20260428100000_person_disambiguation migration.
-- That migration failed mid-apply on production, leaving the DB in an
-- unknown intermediate state. This idempotent cleanup undoes any partial
-- changes so the schema matches the reverted prisma/schema.prisma.
--
-- Each statement is guarded so re-running is safe and the migration applies
-- cleanly whether the failed migration touched the DB at all or applied
-- some-but-not-all of its statements.

ALTER TABLE "Person" DROP COLUMN IF EXISTS "institution";

DROP INDEX IF EXISTS "Person_normalizedName_unclaimed";
DROP INDEX IF EXISTS "Person_normalizedName_claimed";
DROP INDEX IF EXISTS "Person_normalizedName_idx";

-- Restore the uniqueness guarantee on Person.normalizedName that the failed
-- migration may have dropped.
--
-- This statement used to be an `ALTER TABLE ... ADD CONSTRAINT` wrapped in
-- `EXCEPTION WHEN duplicate_object`, and it was wrong twice over:
--
--   1. ADD CONSTRAINT ... UNIQUE builds an index behind the scenes, so a
--      name collision raises `duplicate_table` (42P07, "relation already
--      exists") — NOT `duplicate_object` (42710). The handler caught a code
--      Postgres never raises here.
--   2. The 20260424120000_init migration creates this as a plain
--      `CREATE UNIQUE INDEX`, not a table constraint. On the production
--      database the reverted migration had already dropped that index, so
--      ADD CONSTRAINT succeeded and nobody noticed. On every FRESH database
--      the index is still there from init, the unhandled 42P07 propagates,
--      and `prisma migrate deploy` aborts.
--
-- The net effect was that the project could not bootstrap a new database
-- from its own migration history at all: new Vercel preview branches, local
-- dev setups and any restore-from-schema all died on this line.
--
-- CREATE UNIQUE INDEX IF NOT EXISTS matches by relation name, so it is a
-- no-op on production (where the name is taken by the constraint's backing
-- index) and restores the index on a fresh database — which is also the
-- shape prisma/schema.prisma's `@unique` expects.
CREATE UNIQUE INDEX IF NOT EXISTS "Person_normalizedName_key" ON "Person"("normalizedName");
