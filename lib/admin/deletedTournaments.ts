import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isMissingTable } from '@/lib/admin/adminChecks';

/**
 * Deleting a tournament, and keeping it deleted (owner, 2026-10-31: "give me
 * the ability to delete tournaments ... note which tournaments i have
 * deleted and avoid ingesting them").
 *
 * A deletion removes the Tournament row (everything stored under it
 * cascades) and records its site address in DeletedTournament. Ingest and
 * the pre-scrape check that list before any fetch and refuse with
 * DeletedTournamentError, whose text starts with DELETED_MARKER: the queue
 * reads the marker as terminal (queue.ts isPermanentError) and the Inbox
 * leaves those jobs out, since the refusal is the admin's own choice.
 *
 * A tournament on anyone's CV is never deleted: that would take it off
 * their CV. The admin ignores it instead (Tournament.ignored).
 *
 * The table is read and written through raw SQL, like AdminCheck, and a
 * database the migration has not reached yet reads as "nothing deleted".
 */

export const DELETED_MARKER = 'Deleted by an admin';

export class DeletedTournamentError extends Error {
  constructor(site: string) {
    super(`${DELETED_MARKER}: ${site} is not ingested`);
    this.name = 'DeletedTournamentError';
  }
}

export type SiteKey = { host: string; slug: string };

/**
 * A tab URL's site address: the host and the first path segment, both
 * lowercased. A root-hosted tab's private URL starts with `privateurls`, so
 * its slug is ''. Only that first segment is read, so a private key (which
 * comes after it) never reaches the table.
 */
export function siteKey(url: string): SiteKey | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const first = (parsed.pathname.split('/').filter(Boolean)[0] ?? '').toLowerCase();
  return { host: parsed.host.toLowerCase(), slug: first === 'privateurls' ? '' : first };
}

/** "host/slug/", or "host/" for a root-hosted tab. */
export const siteText = (k: SiteKey) => (k.slug ? `${k.host}/${k.slug}/` : `${k.host}/`);

/** The tab's public home page. */
export const publicTabUrl = (k: SiteKey) => `https://${siteText(k)}`;

export async function isDeletedSite(url: string): Promise<boolean> {
  const k = siteKey(url);
  if (!k) return false;
  try {
    const rows = await prisma.$queryRaw<Array<{ hit: number }>>(Prisma.sql`
      SELECT 1 AS "hit" FROM "DeletedTournament"
      WHERE "host" = ${k.host} AND "slug" = ${k.slug}
      LIMIT 1`);
    return rows.length > 0;
  } catch (err) {
    if (isMissingTable(err)) return false;
    throw err;
  }
}

/** Throws DeletedTournamentError when the URL's tab was deleted by an admin. */
export async function refuseDeletedSite(url: string): Promise<void> {
  const k = siteKey(url);
  if (k && (await isDeletedSite(url))) throw new DeletedTournamentError(siteText(k));
}

export type DeleteOutcome =
  { kind: 'deleted'; name: string } | { kind: 'not_found' } | { kind: 'on_cvs'; users: number };

/**
 * The users with this tournament on their CV: the same count as the audit's
 * "users affected", one per user whose discovered URL links it.
 */
export async function cvUsers(id: bigint): Promise<number> {
  const users = await prisma.discoveredUrl.groupBy({ by: ['userId'], where: { tournamentId: id } });
  return users.length;
}

export async function deleteTournament(id: bigint, by: string): Promise<DeleteOutcome> {
  const t = await prisma.tournament.findUnique({
    where: { id },
    select: { name: true, sourceUrlRaw: true },
  });
  if (!t) return { kind: 'not_found' };
  const users = await cvUsers(id);
  if (users > 0) return { kind: 'on_cvs', users };
  const k = siteKey(t.sourceUrlRaw);
  await prisma.$transaction([
    ...(k
      ? [
          prisma.$executeRaw(Prisma.sql`
            INSERT INTO "DeletedTournament" ("host", "slug", "name", "tabUrl", "deletedBy")
            VALUES (${k.host}, ${k.slug}, ${t.name}, ${publicTabUrl(k)}, ${by})
            ON CONFLICT ("host", "slug") DO UPDATE SET
              "name" = EXCLUDED."name",
              "deletedBy" = EXCLUDED."deletedBy",
              "deletedAt" = CURRENT_TIMESTAMP`),
        ]
      : []),
    prisma.tournament.delete({ where: { id } }),
  ]);
  return { kind: 'deleted', name: t.name };
}

export type DeletedRow = {
  id: string;
  name: string;
  tabUrl: string;
  deletedBy: string;
  deletedAt: Date;
};

/** The deleted tab addresses, newest first, at most 200. */
export async function listDeleted(): Promise<DeletedRow[]> {
  try {
    const rows = await prisma.$queryRaw<Array<Omit<DeletedRow, 'id'> & { id: bigint }>>(Prisma.sql`
      SELECT "id", "name", "tabUrl", "deletedBy", "deletedAt" FROM "DeletedTournament"
      ORDER BY "deletedAt" DESC, "id" DESC
      LIMIT 200`);
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** Takes a tab address off the list, so it can be ingested again. False when it was not on it. */
export async function allowAgain(id: bigint): Promise<boolean> {
  const n = await prisma.$executeRaw(
    Prisma.sql`DELETE FROM "DeletedTournament" WHERE "id" = ${id}`,
  );
  return n > 0;
}
