-- How many of a team's speakers are redacted (opted out of the public tabs),
-- on the team-tab row (roundNumber 0), counted from the participants list.
-- Additive and nullable: null means "never counted", which is every row
-- written before this column.
ALTER TABLE "TeamResult" ADD COLUMN "redactedSpeakers" INTEGER;
