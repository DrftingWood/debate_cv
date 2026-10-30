/**
 * A tab URL short enough for a table cell, with the private key cut off: a
 * `/privateurls/<key>/` link signs in as that participant, so it never goes
 * on screen whole, even on an admin page.
 */
export function shortUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname.replace(/\/privateurls\/.*/, '/…')}`;
  } catch {
    return url;
  }
}
