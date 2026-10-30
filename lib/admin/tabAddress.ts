import { publicPieceUrl } from '@/lib/audit/types';
import { isAllowedTabHost } from '@/lib/gmail/extract';

/**
 * Reading what an admin typed into the tournament search: a URL or a name,
 * and for a URL its site address. Pure, with no database, so the client
 * search box can tell a URL from a name before it decides where to send it.
 */

export type TabAddress = { host: string; slug: string | null; publicUrl: string | null };

/**
 * The site address of a tab URL, or null for anything that is not one: not
 * http(s), not a tab host we know (the ingest's allowlist), or carrying
 * credentials or a port. The slug is the first path segment, unless that is
 * `privateurls` itself or is not a slug's shape; then it is null.
 */
export function parseTabAddress(input: string): TabAddress | null {
  let u: URL;
  try {
    u = new URL(input.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  if (!isAllowedTabHost(u.hostname) || u.username || u.password || u.port) return null;
  const first = u.pathname.split('/').filter(Boolean)[0];
  const slug =
    first && first.toLowerCase() !== 'privateurls' && /^[\w-]+$/.test(first) ? first : null;
  return { host: u.host, slug, publicUrl: slug ? `${u.origin}/${slug}/` : null };
}

/** Is the search box's text a URL (looked up) rather than a name (searched)? */
export function looksLikeUrl(q: string): boolean {
  try {
    const u = new URL(q.trim());
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * What the search box may show again after a search: the text as typed,
 * unless it carries a `/privateurls/` segment, in which case its public
 * form (or nothing, when it has none). The box is rendered from the request,
 * and the page's HTML must never hold the key.
 */
export function searchBoxValue(q: string | undefined): string {
  if (!q) return '';
  if (!/\/privateurls(\/|$)/i.test(q)) return q;
  return (looksLikeUrl(q) ? publicPieceUrl(q.trim()) : null) ?? '';
}
