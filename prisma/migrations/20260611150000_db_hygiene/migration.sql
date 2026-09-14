-- Database-hygiene pass from the 2026-06 schema audit. Each statement maps
-- to a verified finding; nothing here changes application-visible data.
--
-- 1. SpeakerRoundScore.positionLabel: the column is part of the
--    (participantId, roundNumber, positionLabel) unique key, and Postgres
--    treats NULLs as distinct in unique indexes — a NULL value would
--    silently bypass dedup. The ingest writer has always coerced null to
--    '' before writing, so the backfill below is expected to touch zero
--    rows; the NOT NULL + default make the invariant structural.
UPDATE "SpeakerRoundScore" SET "positionLabel" = '' WHERE "positionLabel" IS NULL;
ALTER TABLE "SpeakerRoundScore"
  ALTER COLUMN "positionLabel" SET DEFAULT '',
  ALTER COLUMN "positionLabel" SET NOT NULL;

-- 2. Dead columns, verified never written by any code path (and the one
--    read of TournamentParticipant.wins was a fallback that could only
--    ever produce NULL):
ALTER TABLE "TeamResult" DROP COLUMN IF EXISTS "losses";
ALTER TABLE "TournamentParticipant" DROP COLUMN IF EXISTS "wins";

-- 3. JudgeAssignment round_results duplicates: the unique key includes
--    three nullable columns (NULL roundNumber on outround rows escapes
--    it), and the old findFirst+create writer had a concurrency window.
--    The writer is now an atomic replace; this cleans up any duplicates
--    that the old window let through. IS NOT DISTINCT FROM makes NULLs
--    compare equal, unlike the unique index.
DELETE FROM "JudgeAssignment" a
USING "JudgeAssignment" b
WHERE a.id > b.id
  AND a."source" = 'round_results'
  AND b."source" = 'round_results'
  AND a."tournamentId" = b."tournamentId"
  AND a."personId" = b."personId"
  AND a."stage" IS NOT DISTINCT FROM b."stage"
  AND a."panelRole" IS NOT DISTINCT FROM b."panelRole"
  AND a."roundNumber" IS NOT DISTINCT FROM b."roundNumber";

-- 4. Index hygiene: drop the (userId) index fully covered by the
--    (userId, url) unique's leading column; add composites for the two
--    hot two-column filters that previously had only single-column
--    coverage (markJobDone's per-user status count, buildCvData's
--    per-user open-report check).
DROP INDEX IF EXISTS "DiscoveredUrl_userId_idx";
CREATE INDEX IF NOT EXISTS "IngestJob_userId_status_idx" ON "IngestJob"("userId", "status");
CREATE INDEX IF NOT EXISTS "CvErrorReport_userId_status_idx" ON "CvErrorReport"("userId", "status");
