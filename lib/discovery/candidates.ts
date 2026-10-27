/**
 * The Found tab's search, in ONE query: the people whose stored name key
 * matches one of the user's alias keys, and their appearances at tournaments
 * the user has no private URL for.
 *
 * Every exclusion is in the same statement, so nothing is read only to be
 * dropped in JavaScript:
 *   - the name: `Person.normalizedName = key`, or, for an alias of two or
 *     more words, `~ pattern` (every word whole and in order; see
 *     `aliasPattern`). The regex is a bound parameter and reads the ~52k
 *     Person rows once per multi-word alias (measured locally: see the PR);
 *     no extension, no new index;
 *   - a suppressed person (opted out) is never a candidate;
 *   - a name another user has claimed is not offered (only unclaimed names
 *     and the user's own);
 *   - a tournament the user holds a private URL for goes through onboarding,
 *     not here (`DiscoveredUrl(userId, ...)`).
 *
 * The common-name guard caps each alias at ALIAS_CAP appearances, newest
 * first, and returns the alias's full count so the page can say "showing the
 * first N" instead of truncating silently. No migration.
 */

import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { aliasPattern, type Alias } from '@/lib/discovery/names';

/** Appearances shown per alias. */
export const ALIAS_CAP = 200;

export type CandidateRow = {
  /** Index into the aliases passed in. */
  alias: number;
  tournamentId: bigint;
  personId: bigint;
  teamName: string | null;
  roles: string[];
  tournamentName: string;
  year: number | null;
  region: string | null;
  sourceUrlRaw: string;
  displayName: string;
  claimedByUserId: string | null;
  /** `exact`: the whole name equals the alias; `contains`: its words, in order. */
  matchKind: 'exact' | 'contains';
  /** Every appearance this alias matched, before the cap. */
  aliasTotal: number;
};

export function candidateQuery(userId: string, aliases: readonly Alias[]): Prisma.Sql {
  const keys = aliases.map((a) => a.key);
  const index = aliases.map((_, i) => i);
  // NULL for a one-word alias: `~ NULL` is never true, so it is equality only.
  const patterns = aliases.map((a) => aliasPattern(a.key));
  // A cheap substring test on the alias's longest word runs before the regex:
  // every pattern match contains that word, so it changes nothing about what
  // matches, but the regex then runs on a few hundred rows instead of every
  // Person (measured locally: ~90 ms per multi-word alias without it).
  const needles = aliases.map((a, i) =>
    patterns[i] == null ? null : a.key.split(' ').reduce((x, y) => (y.length > x.length ? y : x)),
  );
  return Prisma.sql`
    WITH k AS (
      SELECT * FROM unnest(${keys}::text[], ${index}::int[], ${patterns}::text[], ${needles}::text[])
        AS k("key", "alias", "pattern", "needle")
    ),
    hits AS (
      SELECT k."alias", tp."id" AS "tpId", tp."tournamentId", tp."personId", tp."teamName",
             t."name" AS "tournamentName", t."year", t."region", t."sourceUrlRaw",
             p."displayName", p."claimedByUserId",
             CASE WHEN p."normalizedName" = k."key" THEN 'exact' ELSE 'contains' END
               AS "matchKind",
             ROW_NUMBER() OVER (
               PARTITION BY k."alias"
               ORDER BY t."year" DESC NULLS LAST, tp."tournamentId", tp."personId"
             ) AS "rn",
             COUNT(*) OVER (PARTITION BY k."alias")::int AS "aliasTotal"
      FROM k
      JOIN "Person" p
        ON p."normalizedName" = k."key"
        OR (strpos(p."normalizedName", k."needle") > 0 AND p."normalizedName" ~ k."pattern")
      JOIN "TournamentParticipant" tp ON tp."personId" = p."id"
      JOIN "Tournament" t ON t."id" = tp."tournamentId"
      WHERE p."suppressedAt" IS NULL
        AND (p."claimedByUserId" IS NULL OR p."claimedByUserId" = ${userId})
        AND tp."tournamentId" NOT IN (
          SELECT du."tournamentId" FROM "DiscoveredUrl" du
          WHERE du."userId" = ${userId} AND du."tournamentId" IS NOT NULL
        )
    )
    SELECT h."alias", h."tournamentId", h."personId", h."teamName", h."tournamentName",
           h."year", h."region", h."sourceUrlRaw", h."displayName", h."claimedByUserId",
           h."matchKind", h."aliasTotal",
           ARRAY(SELECT pr."role" FROM "ParticipantRole" pr
                 WHERE pr."tournamentParticipantId" = h."tpId" ORDER BY pr."role") AS "roles"
    FROM hits h
    WHERE h."rn" <= ${ALIAS_CAP}
    ORDER BY h."alias", h."rn"
  `;
}

export async function findCandidates(
  userId: string,
  aliases: readonly Alias[],
): Promise<CandidateRow[]> {
  if (aliases.length === 0) return [];
  return prisma.$queryRaw<CandidateRow[]>(candidateQuery(userId, aliases));
}
