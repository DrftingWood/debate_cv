-- One-time backfill (owner, 2026-10-30): a tournament stored with no year
-- (pre-scraped, its name holds none) takes the year of the earliest email
-- that carried a private URL to it. From now on ingest does the same as
-- each link is joined (lib/calicotab/yearFromEmail.ts). Only null years are
-- filled; fingerprints are not touched. "messageDate" is TIMESTAMP(3)
-- holding UTC, so EXTRACT gives the UTC year, as getUTCFullYear() does.
UPDATE "Tournament" t
SET "year" = sub."year",
    "updatedAt" = NOW()
FROM (
  SELECT "tournamentId", EXTRACT(YEAR FROM MIN("messageDate"))::int AS "year"
  FROM "DiscoveredUrl"
  WHERE "tournamentId" IS NOT NULL
    AND "messageDate" IS NOT NULL
  GROUP BY "tournamentId"
) sub
WHERE t."id" = sub."tournamentId"
  AND t."year" IS NULL;
