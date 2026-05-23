-- Sub-project 9b: backfill ParticipantRole 'judge' rows for legacy
-- participants who had judge signals (judgeTypeTag, chairedPrelimRounds,
-- lastOutroundChaired, lastOutroundPaneled) but no role row. After this
-- migration applies, the role row is authoritative for isJudge and the
-- 5-signal OR in lib/cv/roleClassification.ts is replaced by a single
-- role check (see same-commit code change).
--
-- INSERT ... WHERE NOT EXISTS is idempotent — re-running the migration
-- (e.g. on a freshly-cloned dev DB) doesn't duplicate rows.

INSERT INTO "ParticipantRole" ("tournamentParticipantId", "role")
SELECT tp.id, 'judge'
FROM "TournamentParticipant" tp
WHERE (
  tp."judgeTypeTag" IS NOT NULL
  OR tp."chairedPrelimRounds" > 0
  OR tp."lastOutroundChaired" IS NOT NULL
  OR tp."lastOutroundPaneled" IS NOT NULL
)
AND NOT EXISTS (
  SELECT 1 FROM "ParticipantRole" pr
  WHERE pr."tournamentParticipantId" = tp.id AND pr.role = 'judge'
);
