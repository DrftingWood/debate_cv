-- Retention groundwork + legacy-write cleanup (Known-gaps backlog).
--
-- 1. EliminationResult: break pages historically wrote 'rank:N' into
--    `result`; nothing ever read those values back (the rank lives on
--    TournamentParticipant.teamBreakRank, and buildCvData filters
--    result IN ('won','lost')). The ingest writer no longer produces
--    them; null the historical rows so the column means one thing.
UPDATE "EliminationResult" SET "result" = NULL WHERE "result" LIKE 'rank:%';

-- 2. @updatedAt on the two actively-mutated tables that lacked it, so
--    "recently touched" queries stop leaning on scheduledAt/finishedAt
--    proxies. DEFAULT CURRENT_TIMESTAMP backfills existing rows and
--    covers raw-SQL writers (Prisma's @updatedAt only fires on client
--    operations; the queue's raw UPDATEs set it explicitly).
ALTER TABLE "IngestJob"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "DiscoveredUrl"
  ADD COLUMN IF NOT EXISTS "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
