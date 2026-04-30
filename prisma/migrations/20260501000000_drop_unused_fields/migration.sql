-- Drop write-only / never-touched columns flagged by the codebase audit.
--
-- Tournament.sourceHost / sourceTournamentSlug:
--   ingest writes them but no read site exists. Reproducing them from
--   sourceUrlRaw is trivial if a future feature ever needs the breakdown.
--
-- TournamentParticipant.teamScoreTotal:
--   never written, never read. Dead since the column was added.
--
-- TournamentParticipant.losses:
--   never written, never read. The wins column is populated alongside
--   prelim/outround results; losses was added speculatively and then
--   never wired up.

ALTER TABLE "Tournament"
  DROP COLUMN "sourceHost",
  DROP COLUMN "sourceTournamentSlug";

ALTER TABLE "TournamentParticipant"
  DROP COLUMN "teamScoreTotal",
  DROP COLUMN "losses";
