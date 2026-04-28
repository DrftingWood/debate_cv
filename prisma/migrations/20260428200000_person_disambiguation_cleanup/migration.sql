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

-- Restore the original UNIQUE constraint that the failed migration may have
-- dropped. duplicate_object → constraint already there → nothing to do.
DO $$
BEGIN
  ALTER TABLE "Person" ADD CONSTRAINT "Person_normalizedName_key" UNIQUE ("normalizedName");
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;
