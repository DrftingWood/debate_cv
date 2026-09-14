/**
 * Where a data subject who has no account writes to. Public by necessity:
 * the privacy page has to give someone whose name we scraped a way to
 * reach a human, and that page renders for signed-out visitors. Unset in
 * dev, so callers must handle null rather than printing "undefined".
 */
export function getPrivacyContactEmail(): string | null {
  const raw = (process.env.NEXT_PUBLIC_PRIVACY_CONTACT_EMAIL ?? '').trim();
  return raw.length > 0 ? raw : null;
}

export function getSiteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : 'https://debate-cv.vercel.app')
  );
}
