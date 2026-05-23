-- Persist the read-time speaker-rank-by-total derivation (previously
-- computed on every CV page view in buildCvData.ts:262-291) as a
-- nullable column on TournamentParticipant. Same column gets
-- recomputed per-tournament inside the ingest write transaction;
-- this migration handles existing rows in one shot.
--
-- Backfill uses ROW_NUMBER() over (tournamentId, speakerScoreTotal DESC)
-- restricted to participant rows that have a 'speaker' role and a
-- non-null speakerScoreTotal — same predicate as the deleted JS
-- block's findMany.where clause. Secondary sort by id ASC gives a
-- deterministic tiebreak (the JS loop's order on ties depended on
-- Postgres row order, which is unordered on ties).

ALTER TABLE "TournamentParticipant"
  ADD COLUMN "speakerRankOpenDerived" INTEGER;

UPDATE "TournamentParticipant" tp
SET "speakerRankOpenDerived" = sub.r
FROM (
  SELECT
    tp2.id,
    ROW_NUMBER() OVER (
      PARTITION BY tp2."tournamentId"
      ORDER BY tp2."speakerScoreTotal" DESC, tp2.id ASC
    ) AS r
  FROM "TournamentParticipant" tp2
  WHERE tp2."speakerScoreTotal" IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM "ParticipantRole" pr
      WHERE pr."tournamentParticipantId" = tp2.id AND pr.role = 'speaker'
    )
) sub
WHERE tp.id = sub.id;
