-- Tournament.sourceUrlRaw held the normalised PRIVATE URL of whoever ingested
-- the tournament first (https://host/slug/privateurls/<token>/). That row is
-- shared by everyone who has the tournament on their record, and the token is
-- one participant's credential for their Tabbycat page; #131 stopped every
-- user-facing path from showing it, and ingest now stores only the public
-- address. This rewrites the rows already stored, so no copy of a token is
-- left on a shared row.
--
-- Same rule as lib/cv/publicTournamentUrl.ts: keep the scheme, the host and
-- the first path segment (the tournament slug); a root-hosted private URL,
-- whose first segment is "privateurls", becomes the site root. Each user's own
-- private URL stays on their DiscoveredUrl, which is what re-ingest uses.
-- Fingerprints are untouched, so nothing re-keys. Idempotent: rewritten rows
-- no longer contain /privateurls/ and are not matched again.
UPDATE "Tournament"
SET "sourceUrlRaw" = CASE
      WHEN lower(split_part(regexp_replace("sourceUrlRaw", '^https?://[^/]+/', '', 'i'), '/', 1)) IN ('', 'privateurls')
        THEN substring("sourceUrlRaw" from '^(?:[Hh][Tt][Tt][Pp][Ss]?://[^/]+/)')
      ELSE substring("sourceUrlRaw" from '^(?:[Hh][Tt][Tt][Pp][Ss]?://[^/]+/[^/?#]+/)')
    END,
    "updatedAt" = NOW()
WHERE "sourceUrlRaw" ~* '/privateurls/';
