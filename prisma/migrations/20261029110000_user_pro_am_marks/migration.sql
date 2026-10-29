-- Redesign owner decision 17: the user marks a partner as pro-am per
-- tournament (Record -> Partners), private unless they opt in. Two additive
-- columns with constant defaults: no table rewrite, no backfill, nobody has
-- a mark and nobody shows one until they choose to.
--
-- Named before 20261029120000_identity_v2_expand (option B phase 2, still
-- unmerged) so the migrations stay in order whichever merges first.
--
-- Rollback (run by hand once the code is reverted; nothing else reads them):
--   ALTER TABLE "User" DROP COLUMN "proAmMarks";
--   ALTER TABLE "User" DROP COLUMN "publicProAmEnabled";
ALTER TABLE "User" ADD COLUMN "proAmMarks" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "User" ADD COLUMN "publicProAmEnabled" BOOLEAN NOT NULL DEFAULT false;
