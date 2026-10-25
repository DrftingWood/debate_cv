/**
 * The link to show for a tournament: its public home, never a private URL.
 *
 * `Tournament.sourceUrlRaw` is the normalised PRIVATE URL of whoever ingested
 * the tournament first (`https://host/slug/privateurls/<token>/`). That token
 * is a credential for that one participant's Tabbycat page, and the same row
 * is shown to everyone else who has the tournament on their record. Putting
 * it in a page, an export or a public CV published it, and let anyone who saw
 * it ingest it and claim that participant. So nothing user-facing may carry
 * the stored value; it passes through here first.
 *
 * Keeps only the origin and the first path segment (the tournament slug), so
 * the token, any deeper path, the query string and the fragment all go. A
 * root-hosted private URL has no slug (its first segment is `privateurls`):
 * the site root is all that is left, which is correct.
 */
export function publicTournamentUrl(raw: string | null | undefined): string {
  if (!raw) return '';
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return '';
  }
  const slug = u.pathname.split('/').filter(Boolean)[0];
  if (!slug || slug.toLowerCase() === 'privateurls') return `${u.origin}/`;
  return `${u.origin}/${slug}/`;
}
