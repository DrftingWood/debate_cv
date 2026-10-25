/**
 * The link to show for a tournament: its public home, never a private URL.
 *
 * `Tournament.sourceUrlRaw` held the normalised PRIVATE URL of whoever ingested
 * the tournament first (`https://host/slug/privateurls/<token>/`). Ingest now
 * stores only the public address and a migration rewrote the old rows
 * (20261026000000_tournament_public_source_url), but every user-facing path
 * still derives the link here, so no row can ever leak one. That token
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
