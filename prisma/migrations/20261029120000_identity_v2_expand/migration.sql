-- Identity option B, phase 2: the expand migration
-- (docs/superpowers/specs/2026-10-27-person-identity-option-b-design.md 3.1, 4.1).
--
-- Adds, empty: four nullable columns on "TournamentParticipant" (listedName,
-- claimedByUserId, claimedAt, claimSource), a nullable "Person"."matchKey"
-- (name key v2), and the per-user "UserNameAlias" table. Nothing reads or
-- writes them yet: phase 3 starts dual-writing, phase 4 switches reads behind
-- IDENTITY_V2_READS. No existing column, row or constraint is changed.
--
-- Lock cost: nullable ADD COLUMN with no default is a catalog change, not a
-- table rewrite. Both indexes are built over all-NULL columns, and the new
-- foreign key validates against an all-NULL column, so each statement holds
-- its lock for milliseconds. The indexes are plain, not CONCURRENTLY, because
-- Prisma runs a migration in one transaction (prisma/prisma#9154).
--
-- Deviation from the spec: the claimedByUserId index is a full btree, not the
-- sketched partial `WHERE "claimedByUserId" IS NOT NULL`. Prisma cannot
-- declare a partial index, and an index that exists only in SQL makes every
-- later `prisma migrate dev` propose dropping it. About 3 MB at B9 scale.
--
-- Rollback (the columns are harmless if left; only if they must go):
--   DROP TABLE "UserNameAlias";
--   ALTER TABLE "TournamentParticipant" DROP CONSTRAINT "TournamentParticipant_claimedByUserId_fkey";
--   DROP INDEX "TournamentParticipant_claimedByUserId_idx";
--   ALTER TABLE "TournamentParticipant" DROP COLUMN "listedName", DROP COLUMN "claimedByUserId",
--     DROP COLUMN "claimedAt", DROP COLUMN "claimSource";
--   DROP INDEX "Person_matchKey_idx";
--   ALTER TABLE "Person" DROP COLUMN "matchKey";
-- then delete this migration's row from "_prisma_migrations".
--
-- Generated with `prisma migrate diff` from the previous schema.

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "matchKey" TEXT;

-- AlterTable
ALTER TABLE "TournamentParticipant" ADD COLUMN     "claimSource" TEXT,
ADD COLUMN     "claimedAt" TIMESTAMP(3),
ADD COLUMN     "claimedByUserId" TEXT,
ADD COLUMN     "listedName" TEXT;

-- CreateTable
CREATE TABLE "UserNameAlias" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "matchKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserNameAlias_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UserNameAlias_userId_matchKey_key" ON "UserNameAlias"("userId", "matchKey");

-- CreateIndex
CREATE INDEX "Person_matchKey_idx" ON "Person"("matchKey");

-- CreateIndex
CREATE INDEX "TournamentParticipant_claimedByUserId_idx" ON "TournamentParticipant"("claimedByUserId");

-- AddForeignKey
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserNameAlias" ADD CONSTRAINT "UserNameAlias_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

