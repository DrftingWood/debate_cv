-- The adjudicator cell of a results row is markup, and older ingests split it
-- on commas straight through its tags, so pieces such as
--   </span><span class="d-inline">Mahor Nagda<i class='adj-symbol'>Ⓣ</i></span>
-- each became a Person of their own (about 8000 rows). parseAdjudicatorCell
-- now reads the spans, and ingest no longer creates a Person for a name that
-- is still markup (lib/calicotab/names.ts isMarkupPersonName); this removes
-- the rows earlier ingests did. The real judges keep their own, clean rows.
--
-- The name pattern is MARKUP_NAME_PATTERN verbatim (tests/calicotab.names.test.ts
-- holds the two together) and runs against displayName, because
-- normalizedName has already lost the tags. Left alone, as in 20260915000000:
--   - claimed rows: a claim is somebody's deliberate act, for an admin to
--     look at rather than a migration to undo;
--   - suppressed rows: the suppression is a withdrawal record.
--
-- Cascades to TournamentParticipant (with its roles and round scores),
-- JudgeAssignment and PersonRejection; DiscoveredUrl.registrationPersonId is
-- set null. The personId indexes those cascades walk were added by
-- 20260915000000. Idempotent: a second run matches nothing.
DELETE FROM "Person"
WHERE "claimedByUserId" IS NULL
  AND "suppressedAt" IS NULL
  AND "displayName" ~ '</?[A-Za-z][A-Za-z0-9]*[ />]';
