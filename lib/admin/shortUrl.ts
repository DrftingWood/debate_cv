/**
 * Page addresses inside admin text, shortened for reading. A parser warning
 * quotes the page it came from ("fetch: speaker HTTP 503 - at https://host/slug/tab/speaker/?p=6"),
 * a long unbroken string that pushed past its cell. The host and the
 * tournament slug are already named by the row, so the text shows only the
 * path after the slug ("tab/speaker/?p=6"); the full public address stays in
 * the cell's title (components/admin/ShortUrlText.tsx).
 *
 * The text reaching here has been scrubbed (lib/admin/scrub.ts), so no
 * private key is in it; dropping the host and slug only removes more.
 */

const URL_IN_TEXT = /https?:\/\/[^\s]+/gi;
/** Punctuation that ends a sentence or closes a bracket, not part of an address. */
const TRAILING = /[).,;:!?\]]+$/;

function shortOne(match: string): string {
  const tail = TRAILING.exec(match)?.[0] ?? '';
  const url = tail ? match.slice(0, -tail.length) : match;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return match;
  }
  const [slug, ...rest] = parsed.pathname.split('/').filter(Boolean);
  if (!slug) return `${parsed.host}${tail}`;
  if (rest.length === 0) return `${parsed.host}/${slug}${tail}`;
  const path = `${rest.join('/')}${parsed.pathname.endsWith('/') ? '/' : ''}`;
  return `${path}${parsed.search}${tail}`;
}

/** The text with each address cut to the path after its tournament slug. */
export function shortenUrls(text: string): string {
  return text.replace(URL_IN_TEXT, shortOne);
}
