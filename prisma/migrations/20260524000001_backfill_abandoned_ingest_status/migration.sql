-- One-time backfill: jobs already marked `failed` whose lastError
-- indicates a HTTP 404 on landing are permanently dead. Convert in
-- place so the new dashboard split (failed vs abandoned) is correct
-- from first deploy.
--
-- Runs in its own migration / transaction so the 'abandoned' enum
-- value added in 20260524000000_add_abandoned_ingest_status is fully
-- committed before this UPDATE references it.
UPDATE "IngestJob"
SET "status" = 'abandoned'
WHERE "status" = 'failed'
  AND "lastError" LIKE '%HTTP 404%';
