-- "Speaker 1", "Orador 2", "Swing B", "Placeholder (do not assign a speaker
-- score)" are an organiser's stand-ins on swing teams, not people. Ingest no
-- longer creates a Person for them (lib/calicotab/names.ts); this removes the
-- rows earlier ingests did. Every tournament using the same stand-in shared
-- ONE row, so each surfaced as a single debater with dozens of tournaments.
--
-- The pattern is PLACEHOLDER_NAME_PATTERN verbatim (tests/calicotab.names.test.ts
-- holds the two together) and runs against normalizedName, which is what it
-- was written for.
--
-- Unclaimed rows only: a claim is somebody's deliberate act, and is left for
-- an admin to look at rather than undone by a migration.
--
-- The delete cascades to TournamentParticipant (with its roles and round
-- scores), JudgeAssignment and PersonRejection; DiscoveredUrl.registrationPersonId
-- is set null. Idempotent: a second run matches nothing.
DELETE FROM "Person"
WHERE "claimedByUserId" IS NULL
  AND "normalizedName" ~ '^(?:(?:speaker|orador|oradora|debater|swing|iron|member|participant)(?: ?[a-z]?[0-9]+(?: [0-9]+)?[a-z]?| [a-z])?|placeholder(?: .*)?|invalid|tba|tbd|[0-9]+)$';
