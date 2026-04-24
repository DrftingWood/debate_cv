-- Tournament roll-ups
ALTER TABLE "Tournament"
  ADD COLUMN "totalParticipants" INTEGER,
  ADD COLUMN "totalTeams"        INTEGER;

-- Per-participant rank and judge aggregates
ALTER TABLE "TournamentParticipant"
  ADD COLUMN "speakerRankOpen"     INTEGER,
  ADD COLUMN "speakerRankEsl"      INTEGER,
  ADD COLUMN "speakerRankEfl"      INTEGER,
  ADD COLUMN "teamBreakRank"       INTEGER,
  ADD COLUMN "judgeTypeTag"        TEXT,
  ADD COLUMN "chairedPrelimRounds" INTEGER,
  ADD COLUMN "lastOutroundChaired" TEXT,
  ADD COLUMN "lastOutroundPaneled" TEXT;
