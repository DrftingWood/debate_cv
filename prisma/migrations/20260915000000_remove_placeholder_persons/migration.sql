-- "Speaker 1", "Orador 2", "Swing B", "<em>Redacted</em>", "Placeholder (do
-- not assign a speaker score)" are stand-ins, not people. Ingest no longer
-- creates a Person for them (lib/calicotab/names.ts); this removes the rows
-- earlier ingests did. Every tournament using the same stand-in shared ONE
-- row, so each surfaced as a single debater with dozens of tournaments.
--
-- The cascades below walk JudgeAssignment and DiscoveredUrl by personId,
-- which had no index: on a synthetic production-sized table the
-- JudgeAssignment cascade alone was 11.9s of a 12.1s delete. Indexed first.
CREATE INDEX IF NOT EXISTS "JudgeAssignment_personId_idx" ON "JudgeAssignment"("personId");
CREATE INDEX IF NOT EXISTS "DiscoveredUrl_registrationPersonId_idx" ON "DiscoveredUrl"("registrationPersonId");

-- The name pattern is PLACEHOLDER_NAME_PATTERN verbatim (tests/calicotab.names.test.ts
-- holds the two together) and runs against normalizedName, which is what it
-- was written for. Left alone:
--   - claimed rows: a claim is somebody's deliberate act, for an admin to
--     look at rather than a migration to undo;
--   - suppressed rows: the suppression is a withdrawal record;
--   - rows whose display name is not plain ASCII: normalisation drops other
--     scripts, so "Iron Ли" would otherwise read as the stand-in "iron".
--
-- Cascades to TournamentParticipant (with its roles and round scores),
-- JudgeAssignment and PersonRejection; DiscoveredUrl.registrationPersonId is
-- set null. Idempotent: a second run matches nothing. The daily prune
-- (prunePlaceholderPersons) runs the same statement.
DELETE FROM "Person"
WHERE "claimedByUserId" IS NULL
  AND "suppressedAt" IS NULL
  AND "displayName" !~ '[^ -~]'
  AND "normalizedName" ~ '^(?:[io] )?(?:(?:swing(?:ing)? )?(?:speaker|orador|oradora|debater|member|participant|partner|judge|adjudicator|iron|swing)(?: (?:[0-9]+[a-z]?|[a-z][0-9]*|[ivx]+|one|two|three|four|five)){0,3}(?: (?:please|do not|dont) .*)?|swing[a-z]*(?: [a-z]+)? [0-9]+[a-z]?(?: .*)?|(?:swing|speaker|orador|iron)(?:[a-z]|[0-9]+[a-z]?)|placeholder.*|(?:em ?)?redacted(?: em)?(?: [0-9]+)?|anonymous(?: [0-9]+)?|invalid|tba|tbd|tbc|n a|dummy(?: [0-9]+)?|[0-9]+(?: [0-9]+)*)$';
