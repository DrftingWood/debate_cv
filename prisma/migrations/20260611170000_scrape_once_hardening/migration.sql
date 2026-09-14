-- Ingest-once hardening (see the audit in this branch's history):
--
-- 1. parserVersion: tournament-scoped parser-version stamp for the cache
--    check. The previous check looked at the latest ParserRun on the
--    caller's own landing SourceDocument, which made every NEW private
--    URL's first touch of an already-cached tournament a full re-scrape.
--    Null backfill is intentional: rows re-stamp on their next (already
--    scheduled, post-version-bump) re-parse.
--
-- 2. scrapeClaimedAt: short-TTL claim marker so concurrent cache-miss
--    ingests of the same tournament don't both run the tab-fetch phase.
ALTER TABLE "Tournament"
  ADD COLUMN IF NOT EXISTS "parserVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "scrapeClaimedAt" TIMESTAMP(3);
