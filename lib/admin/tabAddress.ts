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

/**
 * Does the text carry a `privateurls` path segment, i.e. someone's private
 * key? Also at the very start, so a bare `privateurls/KEY` pasted on its own
 * is caught and never sent off as a name search.
 */
export function hasPrivateKeyPath(q: string): boolean {
  return /(^|\/)privateurls(\/|$)/i.test(q);
}

/**
 * The search box's text as a URL to look up, or null for a name to search.
 * Text that parses as http(s) is a URL; so is any text with a
 * `/privateurls/` segment, scheme or not (`host/slug/privateurls/KEY/` pasted
 * without its https://), which is given one, so a key is never sent off as a
 * name search and put in an address.
 */
export function asLookupUrl(q: string): string | null {
  const text = q.trim();
  const candidates = [text];
  // A bare `privateurls/KEY` has no host to give a scheme to: prefixing it
  // would read `privateurls` as the host and leave the key looking like a
  // public path, which searchBoxValue would then echo back.
  const hostless = /^\/*privateurls(\/|$)/i.test(text);
  if (hasPrivateKeyPath(text) && !hostless && !/^[a-z][\w+.-]*:/i.test(text)) {
    candidates.unshift(`https://${text.replace(/^\/+/, '')}`);
  }
  for (const c of candidates) {
    try {
      const u = new URL(c);
      if (u.protocol === 'https:' || u.protocol === 'http:') return c;
    } catch {
      // not this one
    }
  }
  return hasPrivateKeyPath(text) ? text : null;
}

/** Is the search box's text a URL (looked up) rather than a name (searched)? */
export function looksLikeUrl(q: string): boolean {
  return asLookupUrl(q) != null;
}

/**
 * The public form of private text (its tab's base), or null when it has none.
 * Same host and slug, so it finds the same tournament.
 */
export function publicFormOf(q: string): string | null {
  const url = asLookupUrl(q);
  return url ? publicPieceUrl(url) : null;
}

/**
 * What the search box may show again after a search: the text as typed,
 * unless it carries a `/privateurls/` segment, in which case its public
 * form (or nothing, when it has none). The box is rendered from the request,
 * and the page's HTML must never hold the key.
 */
export function searchBoxValue(q: string | undefined): string {
  if (!q) return '';
  if (!hasPrivateKeyPath(q)) return q;
  return publicFormOf(q) ?? '';
}
