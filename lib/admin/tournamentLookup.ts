import { prisma } from '@/lib/db';
import { band } from '@/lib/audit/score';
import { publicPieceUrl } from '@/lib/audit/types';
import { findTournamentByHostSlug } from '@/lib/calicotab/storedFirst';
import { PARSER_VERSION } from '@/lib/calicotab/version';
import { parseTabAddress } from '@/lib/admin/tabAddress';

/**
 * "Is this tournament in the database?" (owner, 2026-10-31). Two answers to
 * the one question: `lookupTournament` for a URL an admin pastes, and
 * `storedTournamentIdsByUrl` for every row of an admin table at once.
 *
 * Both name a tournament by its site address, host plus slug, as the
 * stored-first import does (findTournamentByHostSlug): within a Tabbycat site
 * a slug names one tournament, so a private URL, a public one and any page
 * under either all find the same row. The private key is never part of a
 * query and never part of an answer: it signs in as the participant, and an
 * admin checking "do we have this?" has no use for it.
 */

export type LookupResult =
  | { kind: 'invalid' }
  | { kind: 'not_stored'; host: string; slug: string | null; publicUrl: string | null }
  | {
      kind: 'stored';
      id: string;
      name: string;
      publicUrl: string | null;
      scrapedAt: Date;
      parserCurrent: boolean;
      score: number | null;
      band: 'good' | 'check' | 'rescrape' | null;
      partlyLoaded: boolean;
    };

export async function lookupTournament(url: string): Promise<LookupResult> {
  const address = parseTabAddress(url);
  if (!address) return { kind: 'invalid' };
  const t = await findTournamentByHostSlug(address.host, address.slug);
  if (!t) return { kind: 'not_stored', ...address };
  const [audit, failing] = await Promise.all([
    prisma.tournamentAudit.findUnique({ where: { tournamentId: t.id }, select: { score: true } }),
    prisma.scrapePiece.count({ where: { tournamentId: t.id, status: 'failed' } }),
  ]);
  return {
    kind: 'stored',
    id: t.id.toString(),
    name: t.name,
    publicUrl: publicPieceUrl(t.sourceUrlRaw) ?? address.publicUrl,
    scrapedAt: t.scrapedAt,
    parserCurrent: t.parserVersion === PARSER_VERSION,
    score: audit?.score ?? null,
    band: audit ? band(audit.score) : null,
    partlyLoaded: failing > 0,
  };
}

export type StoredRef = { id: string; name: string; scrapedAt: Date };

/** Site addresses per query: two prefixes each, so at most 200 OR terms. */
const KEYS_PER_QUERY = 100;

const keyOf = (host: string, slug: string) => `${host.toLowerCase()}/${slug.toLowerCase()}`;

/**
 * The stored tournament behind each URL, for a table's rows: one query per
 * hundred distinct site addresses, however many URLs share them (thirty
 * private URLs to three tournaments ask once, for three). A URL whose
 * address matches no row, or more than one, is left out of the map, as
 * findTournamentByHostSlug adopts none when it cannot tell rows apart.
 */
export async function storedTournamentIdsByUrl(urls: string[]): Promise<Map<string, StoredRef>> {
  return (await storedMatchesByUrl(urls)).stored;
}

export type StoredMatches = {
  /** URLs whose address matched exactly one stored tournament. */
  stored: Map<string, StoredRef>;
  /**
   * URLs whose address matched two or more stored rows, with how many. Such
   * a tournament is stored, just not told apart, so a table says "? Check"
   * for it rather than "✗ Not loaded" (Task 5d).
   */
  ambiguous: Map<string, number>;
};

/** storedTournamentIdsByUrl, with the ambiguous addresses kept apart instead of dropped. */
export async function storedMatchesByUrl(urls: string[]): Promise<StoredMatches> {
  const urlsByKey = new Map<string, string[]>();
  for (const url of urls) {
    const a = parseTabAddress(url);
    if (!a?.slug) continue;
    const key = keyOf(a.host, a.slug);
    urlsByKey.set(key, [...(urlsByKey.get(key) ?? []), url]);
  }
  const keys = [...urlsByKey.keys()];
  const rowsByKey = new Map<string, StoredRef[]>();
  for (let i = 0; i < keys.length; i += KEYS_PER_QUERY) {
    for (const row of await storedRowsFor(keys.slice(i, i + KEYS_PER_QUERY))) {
      const key = rowKey(row.sourceUrlRaw);
      if (!key) continue;
      const ref = { id: row.id.toString(), name: row.name, scrapedAt: row.scrapedAt };
      rowsByKey.set(key, [...(rowsByKey.get(key) ?? []), ref]);
    }
  }
  const stored = new Map<string, StoredRef>();
  const ambiguous = new Map<string, number>();
  for (const [key, list] of rowsByKey) {
    for (const url of urlsByKey.get(key) ?? []) {
      if (list.length === 1) stored.set(url, list[0]);
      else ambiguous.set(url, list.length);
    }
  }
  return { stored, ambiguous };
}

/**
 * A stored row's site address, split the way the query matched it: the
 * text between `scheme://` and the next two slashes, compared without case.
 * Deliberately not parseTabAddress: a row the prefix matched must land on
 * the key it was matched for, or the table would say "Not stored" where
 * lookupTournament (findTournamentByHostSlug) says "Stored".
 */
function rowKey(sourceUrlRaw: string): string | null {
  const m = /^https?:\/\/([^/]+)\/([^/]+)\//i.exec(sourceUrlRaw);
  return m ? keyOf(m[1], m[2]) : null;
}

function storedRowsFor(keys: string[]) {
  // Either scheme, as findTournamentByHostSlug: private URLs have been
  // stored as http:// as well as https://.
  return prisma.tournament.findMany({
    where: {
      OR: keys.flatMap((k) => [
        { sourceUrlRaw: { startsWith: `https://${k}/`, mode: 'insensitive' as const } },
        { sourceUrlRaw: { startsWith: `http://${k}/`, mode: 'insensitive' as const } },
      ]),
    },
    select: { id: true, name: true, sourceUrlRaw: true, scrapedAt: true },
  });
}
