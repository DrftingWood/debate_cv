-- Add the `abandoned` value to IngestJobStatus for permanently-dead URLs
-- (HTTP 404 on landing pages — typically dead Heroku free-tier apps that
-- have been shut down). Distinct from `failed` so the dashboard's
-- actionable-failed count stays accurate and retry-failed naturally
-- skips them via the type rather than fragile regex matching on
-- lastError.
ALTER TYPE "IngestJobStatus" ADD VALUE 'abandoned';

-- One-time backfill: jobs already marked `failed` whose lastError
-- indicates a HTTP 404 on landing are permanently dead. Convert in
-- place so the new dashboard split is correct from first deploy.
-- Note: this runs in a separate transaction from the ALTER TYPE above
-- (Postgres requires enum value additions to be visible in their own
-- transaction before they can be used in DML). Prisma's migration
-- engine handles the commit boundary automatically between statements
-- in the same file — but if you see "unsafe use of new value" in
-- production, split this into two migration files:
--   20260524000000_add_abandoned_ingest_status  (just the ALTER TYPE)
--   20260524000001_backfill_abandoned_ingest_status  (just this UPDATE)
UPDATE "IngestJob"
SET "status" = 'abandoned'
WHERE "status" = 'failed'
  AND "lastError" LIKE '%HTTP 404%';
