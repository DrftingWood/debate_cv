-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "IngestJobStatus" AS ENUM ('pending', 'running', 'done', 'failed');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "GmailToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "refreshToken" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GmailToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveredUrl" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "host" TEXT NOT NULL,
    "tournamentSlug" TEXT,
    "token" TEXT,
    "subject" TEXT,
    "messageId" TEXT,
    "messageDate" TIMESTAMP(3),
    "tournamentId" BIGINT,
    "ingestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscoveredUrl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestJob" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "status" "IngestJobStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "IngestJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tournament" (
    "id" BIGSERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "format" TEXT,
    "year" INTEGER,
    "sourceUrlRaw" TEXT NOT NULL,
    "sourceHost" TEXT,
    "sourceTournamentSlug" TEXT,
    "fingerprint" TEXT NOT NULL,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tournament_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Person" (
    "id" BIGSERIAL NOT NULL,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "claimedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TournamentParticipant" (
    "id" BIGSERIAL NOT NULL,
    "tournamentId" BIGINT NOT NULL,
    "personId" BIGINT NOT NULL,
    "teamName" TEXT,
    "speakerScoreTotal" DECIMAL(65,30),
    "teamScoreTotal" DECIMAL(65,30),
    "wins" INTEGER,
    "losses" INTEGER,
    "eliminationReached" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TournamentParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParticipantRole" (
    "tournamentParticipantId" BIGINT NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "ParticipantRole_pkey" PRIMARY KEY ("tournamentParticipantId","role")
);

-- CreateTable
CREATE TABLE "SpeakerRoundScore" (
    "id" BIGSERIAL NOT NULL,
    "tournamentParticipantId" BIGINT NOT NULL,
    "roundNumber" INTEGER NOT NULL,
    "positionLabel" TEXT,
    "score" DECIMAL(65,30),

    CONSTRAINT "SpeakerRoundScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TeamResult" (
    "id" BIGSERIAL NOT NULL,
    "tournamentId" BIGINT NOT NULL,
    "teamName" TEXT NOT NULL,
    "roundNumber" INTEGER,
    "wins" INTEGER,
    "losses" INTEGER,
    "points" DECIMAL(65,30),

    CONSTRAINT "TeamResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EliminationResult" (
    "id" BIGSERIAL NOT NULL,
    "tournamentId" BIGINT NOT NULL,
    "stage" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityName" TEXT NOT NULL,
    "result" TEXT,

    CONSTRAINT "EliminationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JudgeAssignment" (
    "id" BIGSERIAL NOT NULL,
    "tournamentId" BIGINT NOT NULL,
    "personId" BIGINT NOT NULL,
    "stage" TEXT,
    "panelRole" TEXT,
    "roundNumber" INTEGER,

    CONSTRAINT "JudgeAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "GmailToken_userId_key" ON "GmailToken"("userId");

-- CreateIndex
CREATE INDEX "DiscoveredUrl_userId_idx" ON "DiscoveredUrl"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredUrl_userId_url_key" ON "DiscoveredUrl"("userId", "url");

-- CreateIndex
CREATE INDEX "IngestJob_status_scheduledAt_idx" ON "IngestJob"("status", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "IngestJob_userId_url_key" ON "IngestJob"("userId", "url");

-- CreateIndex
CREATE UNIQUE INDEX "Tournament_fingerprint_key" ON "Tournament"("fingerprint");

-- CreateIndex
CREATE INDEX "Tournament_year_idx" ON "Tournament"("year");

-- CreateIndex
CREATE INDEX "Tournament_format_idx" ON "Tournament"("format");

-- CreateIndex
CREATE UNIQUE INDEX "Person_normalizedName_key" ON "Person"("normalizedName");

-- CreateIndex
CREATE INDEX "Person_claimedByUserId_idx" ON "Person"("claimedByUserId");

-- CreateIndex
CREATE INDEX "TournamentParticipant_tournamentId_idx" ON "TournamentParticipant"("tournamentId");

-- CreateIndex
CREATE INDEX "TournamentParticipant_personId_idx" ON "TournamentParticipant"("personId");

-- CreateIndex
CREATE UNIQUE INDEX "TournamentParticipant_tournamentId_personId_key" ON "TournamentParticipant"("tournamentId", "personId");

-- CreateIndex
CREATE UNIQUE INDEX "SpeakerRoundScore_tournamentParticipantId_roundNumber_posit_key" ON "SpeakerRoundScore"("tournamentParticipantId", "roundNumber", "positionLabel");

-- CreateIndex
CREATE UNIQUE INDEX "TeamResult_tournamentId_teamName_roundNumber_key" ON "TeamResult"("tournamentId", "teamName", "roundNumber");

-- CreateIndex
CREATE UNIQUE INDEX "EliminationResult_tournamentId_stage_entityType_entityName_key" ON "EliminationResult"("tournamentId", "stage", "entityType", "entityName");

-- CreateIndex
CREATE UNIQUE INDEX "JudgeAssignment_tournamentId_personId_stage_panelRole_round_key" ON "JudgeAssignment"("tournamentId", "personId", "stage", "panelRole", "roundNumber");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GmailToken" ADD CONSTRAINT "GmailToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredUrl" ADD CONSTRAINT "DiscoveredUrl_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredUrl" ADD CONSTRAINT "DiscoveredUrl_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestJob" ADD CONSTRAINT "IngestJob_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_claimedByUserId_fkey" FOREIGN KEY ("claimedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TournamentParticipant" ADD CONSTRAINT "TournamentParticipant_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParticipantRole" ADD CONSTRAINT "ParticipantRole_tournamentParticipantId_fkey" FOREIGN KEY ("tournamentParticipantId") REFERENCES "TournamentParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SpeakerRoundScore" ADD CONSTRAINT "SpeakerRoundScore_tournamentParticipantId_fkey" FOREIGN KEY ("tournamentParticipantId") REFERENCES "TournamentParticipant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamResult" ADD CONSTRAINT "TeamResult_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EliminationResult" ADD CONSTRAINT "EliminationResult_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeAssignment" ADD CONSTRAINT "JudgeAssignment_tournamentId_fkey" FOREIGN KEY ("tournamentId") REFERENCES "Tournament"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JudgeAssignment" ADD CONSTRAINT "JudgeAssignment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

