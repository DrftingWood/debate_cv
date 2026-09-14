-- Phase-2 analytics groundwork: persist the per-round team side the
-- round-results parser already extracts (it was silently dropped before),
-- store motions from the /tab/motions/ page, and start retaining gzipped
-- raw HTML on SourceDocument so future parser additions can re-derive
-- fields from storage instead of forcing a full re-scrape (which is lossy
-- once a tournament's Heroku tab dies).
--
-- Existing rows keep NULLs everywhere; values arrive as tournaments
-- re-ingest under the bumped PARSER_VERSION.

ALTER TABLE "TeamResult"
  ADD COLUMN IF NOT EXISTS "position" TEXT;

ALTER TABLE "SourceDocument"
  ADD COLUMN IF NOT EXISTS "bodyGzip" BYTEA;

CREATE TABLE "Motion" (
  "id" BIGSERIAL NOT NULL,
  "tournamentId" BIGINT NOT NULL,
  "roundNumber" INTEGER,
  "roundLabel" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "text" TEXT NOT NULL,
  "infoSlide" TEXT,

  CONSTRAINT "Motion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Motion_tournamentId_roundLabel_seq_key"
  ON "Motion"("tournamentId", "roundLabel", "seq");

CREATE INDEX "Motion_tournamentId_idx" ON "Motion"("tournamentId");

ALTER TABLE "Motion"
  ADD CONSTRAINT "Motion_tournamentId_fkey"
  FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
