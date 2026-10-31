import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isMissingTable } from '@/lib/admin/adminChecks';
import { isAllowedTabHost } from '@/lib/gmail/extract';

/**
 * Tabs that moved to another address (owner, 2026-10-31: "allow me to add an
 * alternate url feature"). A tournament's old site can stop serving it (a
 * Heroku app shut down, a host renamed) while the same tab, private keys
 * included, lives on elsewhere. An admin records the move on the Tools tab;
 * from then on every URL to the old site and slug is read from the new one,
 * keeping the rest of its path. Applied where a fetch is about to happen
 * (ingest's landing load, the stored-first match, the public landing load),
 * never to what is stored for a user: their URL stays as it came, and
 * ingest looks it up under both spellings.
 *
 * Read and written through raw SQL, like AdminCheck; a database without the
 * table has no moves. The list is small and read on every ingest, so it is
 * kept for a minute per server instance.
 */

export type TabMove = {
  id: string;
  fromHost: string;
  /** '' for a root-hosted tab. */
  fromSlug: string;
  toHost: string;
  toSlug: string;
  addedBy: string;
  addedAt: Date;
};

type Site = { host: string; slug: string };

/** A URL's site: lowercased host and first path segment ('' at the root or before `privateurls`). */
export function siteOf(url: string): Site | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const first = (parsed.pathname.split('/').filter(Boolean)[0] ?? '').toLowerCase();
  return { host: parsed.hostname.toLowerCase(), slug: first === 'privateurls' ? '' : first };
}

/** "host/slug/", or "host/" at the root. */
export const siteLabel = (host: string, slug: string) => (slug ? `${host}/${slug}/` : `${host}/`);

/** The URL at its tab's current address under these moves: unchanged unless its site moved. */
export function applyMoves(url: string, moves: readonly TabMove[]): string {
  const site = siteOf(url);
  if (!site) return url;
  const move = moves.find((m) => m.fromHost === site.host && m.fromSlug === site.slug);
  if (!move) return url;
  const parsed = new URL(url);
  const parts = parsed.pathname.split('/').filter(Boolean);
  // The old slug, when there was one, is the first segment; the rest of the
  // path (privateurls/<key>/, tab/team/, ...) is kept as it was.
  const rest = site.slug ? parts.slice(1) : parts;
  const path = [move.toSlug, ...rest].filter(Boolean).join('/');
  parsed.hostname = move.toHost;
  // The tab sites are served over https, whatever scheme the old link had.
  parsed.protocol = 'https:';
  parsed.pathname = path ? `/${path}/` : '/';
  return parsed.toString();
}

const TTL_MS = 60_000;
let cache: { at: number; moves: TabMove[] } | null = null;

/** Forget the kept list, so a change made here is used at once. */
export function clearTabMovesCache(): void {
  cache = null;
}

type MoveRow = Omit<TabMove, 'id'> & { id: bigint };

export async function listTabMoves(): Promise<TabMove[]> {
  try {
    const rows = await prisma.$queryRaw<MoveRow[]>(Prisma.sql`
      SELECT "id", "fromHost", "fromSlug", "toHost", "toSlug", "addedBy", "addedAt"
      FROM "TabMove" ORDER BY "addedAt" DESC, "id" DESC LIMIT 500`);
    return rows.map((r) => ({ ...r, id: r.id.toString() }));
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

/** The URL at its tab's current address, from the recorded moves. */
export async function currentTabUrl(url: string): Promise<string> {
  if (!cache || Date.now() - cache.at > TTL_MS) {
    cache = { at: Date.now(), moves: await listTabMoves() };
  }
  return applyMoves(url, cache.moves);
}

export type AddMoveOutcome =
  | { kind: 'added'; move: Omit<TabMove, 'id' | 'addedBy' | 'addedAt'>; requeued: number }
  | { kind: 'invalid'; reason: 'from' | 'to' | 'same' };

/**
 * Records that the tab at `fromUrl` now lives at `toUrl` (either may be any
 * URL on the tab; only the site and slug are kept, never a private key), and
 * puts the failed or abandoned imports of the old address back in the queue
 * so the people they belong to get the tournament. Adding a move for an old
 * site that already has one replaces it.
 */
export async function addTabMove(
  fromUrl: string,
  toUrl: string,
  by: string,
): Promise<AddMoveOutcome> {
  const from = siteOf(fromUrl);
  const to = siteOf(toUrl);
  if (!from) return { kind: 'invalid', reason: 'from' };
  if (!to || !isAllowedTabHost(to.host) || !toUrl.trim().toLowerCase().startsWith('https://'))
    return { kind: 'invalid', reason: 'to' };
  if (from.host === to.host && from.slug === to.slug) return { kind: 'invalid', reason: 'same' };
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "TabMove" ("fromHost", "fromSlug", "toHost", "toSlug", "addedBy")
    VALUES (${from.host}, ${from.slug}, ${to.host}, ${to.slug}, ${by})
    ON CONFLICT ("fromHost", "fromSlug") DO UPDATE SET
      "toHost" = EXCLUDED."toHost",
      "toSlug" = EXCLUDED."toSlug",
      "addedBy" = EXCLUDED."addedBy",
      "addedAt" = CURRENT_TIMESTAMP`);
  clearTabMovesCache();
  const requeued = await requeueOldAddress(from);
  return {
    kind: 'added',
    move: { fromHost: from.host, fromSlug: from.slug, toHost: to.host, toSlug: to.slug },
    requeued,
  };
}

/** Takes a move off the list. False when it was not on it. */
export async function removeTabMove(id: bigint): Promise<boolean> {
  const n = await prisma.$executeRaw(Prisma.sql`DELETE FROM "TabMove" WHERE "id" = ${id}`);
  clearTabMovesCache();
  return n > 0;
}

/**
 * Failed or abandoned imports of the old address back to pending, as the
 * admin retry does (attempts reset). Matched on the site prefix in either
 * scheme; a URL a user locked is left alone, as every bulk retry leaves it.
 */
async function requeueOldAddress(from: Site): Promise<number> {
  // LIKE treats _ and % as wildcards; a slug may hold an underscore.
  const prefix = siteLabel(from.host, from.slug).replace(/[\\_%]/g, (c) => `\\${c}`);
  return prisma.$executeRaw(Prisma.sql`
    UPDATE "IngestJob" j SET
      "status" = 'pending', "attempts" = 0, "lastError" = NULL,
      "startedAt" = NULL, "finishedAt" = NULL, "scheduledAt" = CURRENT_TIMESTAMP
    WHERE j."status" IN ('failed', 'abandoned')
      AND (j."url" ILIKE ${`https://${prefix}%`} OR j."url" ILIKE ${`http://${prefix}%`})
      AND NOT EXISTS (
        SELECT 1 FROM "DiscoveredUrl" d
        WHERE d."userId" = j."userId" AND d."url" = j."url" AND d."reingestLocked" = true
      )`);
}
