import { prisma } from '@/lib/db';
import type { WarningGroup } from '@/lib/admin/parserWarnings';
import { storedMatchesByUrl } from '@/lib/admin/tournamentLookup';

/**
 * Ignored tournaments (test and demo ones an admin set aside) leave every
 * kind of Inbox item. Checks are filtered in the audit read itself
 * (inbox.ts); the two kinds below name their tournaments loosely, so each is
 * filtered here, by the same rule: an item goes when at least one tournament
 * of it resolves to a stored row and every one that does is ignored. An item
 * naming no stored tournament stays, as does one that also touches a
 * tournament that is not ignored.
 *
 * Failed imports need no filter: a job whose tournament resolves to a stored
 * row, ignored or not, is "covered by the stored copy" and is already out of
 * the Inbox and its counts (readFailedJobs, side 'unstored'). Both the list
 * and countInbox read through these, so "Needs you" and the lists agree.
 */

/** The ignored flag of each stored tournament among `ids` (digits only; others are skipped). */
async function ignoredFlags(ids: string[]): Promise<Map<string, boolean>> {
  const wanted = [...new Set(ids)].filter((id) => /^\d{1,18}$/.test(id));
  if (wanted.length === 0) return new Map();
  const rows = await prisma.tournament.findMany({
    where: { id: { in: wanted.map((id) => BigInt(id)) } },
    select: { id: true, ignored: true },
  });
  return new Map(rows.map((r) => [r.id.toString(), r.ignored] as const));
}

/** True when some id resolved and every id that did is ignored. */
function onlyIgnored(ids: string[], flags: ReadonlyMap<string, boolean>): boolean {
  const resolved = ids.flatMap((id) => (flags.has(id) ? [flags.get(id)!] : []));
  return resolved.length > 0 && resolved.every(Boolean);
}

/** Open reports, without those about ignored tournaments only. */
export async function withoutIgnoredReports<T extends { r: { tournamentIds: string[] } }>(
  open: T[],
): Promise<T[]> {
  const flags = await ignoredFlags(open.flatMap((x) => x.r.tournamentIds));
  return open.filter((x) => !onlyIgnored(x.r.tournamentIds, flags));
}

/** Open parser groups, without those whose pages all belong to ignored tournaments. */
export async function withoutIgnoredParserGroups<T extends { g: Pick<WarningGroup, 'urls'> }>(
  open: T[],
): Promise<T[]> {
  const urls = [...new Set(open.flatMap((x) => x.g.urls))];
  if (urls.length === 0) return open;
  const { stored } = await storedMatchesByUrl(urls);
  const flags = await ignoredFlags([...stored.values()].map((s) => s.id));
  return open.filter((x) => {
    const ids = x.g.urls.flatMap((u) => stored.get(u)?.id ?? []);
    return !onlyIgnored(ids, flags);
  });
}
