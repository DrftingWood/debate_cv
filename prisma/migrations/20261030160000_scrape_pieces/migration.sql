-- CreateTable
CREATE TABLE "ScrapePiece" (
    "id" BIGSERIAL NOT NULL,
    "tournamentId" BIGINT NOT NULL,
    "kind" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "lastError" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL,
    "loadedAt" TIMESTAMP(3),
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScrapePiece_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ScrapePiece_status_nextRetryAt_idx" ON "ScrapePiece"("status", "nextRetryAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScrapePiece_tournamentId_kind_key_key" ON "ScrapePiece"("tournamentId", "kind", "key");

-- AddForeignKey
ALTER TABLE "ScrapePiece" ADD CONSTRAINT "ScrapePiece_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;
