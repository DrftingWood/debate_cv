-- C101: per-tournament hide on the public CV. An additive column with a
-- constant default: no table rewrite, no backfill, existing users keep every
-- tournament visible (empty list = show all).
--
-- Rollback (run by hand; nothing else depends on the column once the code is
-- reverted):
--   ALTER TABLE "User" DROP COLUMN "publicHiddenTournamentIds";
ALTER TABLE "User" ADD COLUMN "publicHiddenTournamentIds" BIGINT[] DEFAULT ARRAY[]::BIGINT[];
