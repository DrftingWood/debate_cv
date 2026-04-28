-- Authoritative prelim round count, set from the landing nav at ingest.
-- Used as the speaker-average divisor when the speaker tab exposes only
-- totals (common on AP installs that strip per-round columns).

ALTER TABLE "Tournament"
  ADD COLUMN IF NOT EXISTS "prelimRoundCount" INTEGER;
