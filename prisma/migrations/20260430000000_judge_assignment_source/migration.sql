-- Add a source column to JudgeAssignment so prepareTournamentWideRefresh
-- can clear stale round-results-derived entries without touching the
-- landing-card-derived ones.
--
-- Backfill: existing rows pre-date the distinction. Default to 'landing'
-- because that's the authoritative source — the URL owner's own re-ingest
-- atomically deletes + re-creates source='landing' rows in
-- recordJudgeRoundsFromLanding, so misclassifying a 'round_results' row as
-- 'landing' just means we miss one cleanup opportunity (the row gets
-- replaced when its true owner next ingests). The opposite mistake would
-- delete authoritative data, which we want to avoid.

ALTER TABLE "JudgeAssignment"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'landing';

CREATE INDEX IF NOT EXISTS "JudgeAssignment_tournamentId_source_idx"
  ON "JudgeAssignment"("tournamentId", "source");
