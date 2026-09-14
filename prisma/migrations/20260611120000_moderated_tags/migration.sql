-- Moderated community tags: tournament region + motion type/topic, all
-- user-proposed and admin-approved (the tab pages expose none of this).
-- Canonical values live on Tournament.region / Motion.motionType /
-- Motion.topic; TagProposal is the moderation queue + audit trail.
-- Vocabulary enforcement happens at the API boundary against
-- lib/tags/vocabulary.ts, deliberately not as DB CHECK constraints, so
-- vocabulary additions stay a one-file change.

ALTER TABLE "Tournament"
  ADD COLUMN IF NOT EXISTS "region" TEXT;

ALTER TABLE "Motion"
  ADD COLUMN IF NOT EXISTS "motionType" TEXT,
  ADD COLUMN IF NOT EXISTS "topic" TEXT;

CREATE TYPE "TagProposalStatus" AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE "TagProposal" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "tournamentId" BIGINT NOT NULL,
  "motionId" BIGINT,
  "value" TEXT NOT NULL,
  "status" "TagProposalStatus" NOT NULL DEFAULT 'pending',
  "adminNote" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),

  CONSTRAINT "TagProposal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "TagProposal_status_createdAt_idx" ON "TagProposal"("status", "createdAt");
CREATE INDEX "TagProposal_userId_tournamentId_idx" ON "TagProposal"("userId", "tournamentId");
CREATE INDEX "TagProposal_motionId_idx" ON "TagProposal"("motionId");

ALTER TABLE "TagProposal"
  ADD CONSTRAINT "TagProposal_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TagProposal"
  ADD CONSTRAINT "TagProposal_tournamentId_fkey"
  FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TagProposal"
  ADD CONSTRAINT "TagProposal_motionId_fkey"
  FOREIGN KEY ("motionId") REFERENCES "Motion"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
