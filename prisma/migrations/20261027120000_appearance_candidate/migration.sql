-- Found tab, phase 1 (docs/superpowers/specs/2026-10-27-discovery-tab-design.md
-- section 2.2): one new table holding a user's "This is me" / "Not me"
-- decisions about public-tab appearances that match their registration names.
-- Read only by /cv/found and its decision route; nothing on the CV reads it.
--
-- Additive only: no existing table, column or row is touched. The foreign
-- keys cascade from User, Tournament and Person, so account deletion, an admin
-- wipe or a stand-in prune clean up after themselves; the two single-column
-- indexes keep those cascades from scanning this table.
--
-- Rollback: DROP TABLE "AppearanceCandidate";
-- (then delete this migration's row from "_prisma_migrations").
--
-- Generated with `prisma migrate diff` from the previous schema.

-- CreateTable
CREATE TABLE "AppearanceCandidate" (
    "id" BIGSERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "tournamentId" BIGINT NOT NULL,
    "personId" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "blockReason" TEXT,
    "proximity" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "evidence" JSONB NOT NULL,
    "aliasId" TEXT,
    "matcherVersion" INTEGER NOT NULL,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppearanceCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AppearanceCandidate_userId_status_idx" ON "AppearanceCandidate"("userId", "status");

-- CreateIndex
CREATE INDEX "AppearanceCandidate_tournamentId_idx" ON "AppearanceCandidate"("tournamentId");

-- CreateIndex
CREATE INDEX "AppearanceCandidate_personId_idx" ON "AppearanceCandidate"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "AppearanceCandidate_userId_tournamentId_personId_key" ON "AppearanceCandidate"("userId", "tournamentId", "personId");

-- AddForeignKey
ALTER TABLE "AppearanceCandidate" ADD CONSTRAINT "AppearanceCandidate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppearanceCandidate" ADD CONSTRAINT "AppearanceCandidate_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AppearanceCandidate" ADD CONSTRAINT "AppearanceCandidate_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;
