-- CreateTable
CREATE TABLE "TournamentAudit" (
    "id" BIGSERIAL NOT NULL,
    "tournamentId" BIGINT NOT NULL,
    "score" INTEGER NOT NULL,
    "checks" JSONB NOT NULL,
    "usersAffected" INTEGER NOT NULL DEFAULT 0,
    "checksVersion" TEXT NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TournamentAudit_tournamentId_key" ON "TournamentAudit"("tournamentId");

-- CreateIndex
CREATE INDEX "TournamentAudit_score_idx" ON "TournamentAudit"("score");

-- CreateIndex
CREATE INDEX "TournamentAudit_computedAt_idx" ON "TournamentAudit"("computedAt");

-- AddForeignKey
ALTER TABLE "TournamentAudit" ADD CONSTRAINT "TournamentAudit_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
