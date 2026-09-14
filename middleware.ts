import { NextResponse, type NextRequest } from 'next/server';

/**
 * Per-request Content-Security-Policy with a nonce.
 *
 * The static headers in next.config.ts (nosniff, frame DENY, HSTS,
 * Referrer-Policy, Permissions-Policy) can't express a CSP, because a
 * useful one needs a fresh nonce per response. This middleware mints that
 * nonce, puts it in the CSP, and forwards it on a request header so
 * app/layout.tsx can stamp it onto the one inline script the app ships
 * (the pre-paint theme switch). Next.js reads the same nonce from the CSP
 * header and applies it to its own hydration scripts.
 *
 * Why the app needs this at all: every surface renders text scraped from
 * third-party tournament sites — motions, team names, tournament names. All
 * of it goes through React's escaping today, but a CSP is the control that
 * still holds if some future change introduces an unescaped sink.
 *
 * `strict-dynamic` means the nonce covers scripts that Next loads
 * transitively, so we don't have to enumerate chunk URLs.
 */
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');

  const directives = [
    `default-src 'self'`,
    // 'unsafe-eval' only in development: React Fast Refresh needs it, and
    // shipping it to production would defeat much of the point.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${
      process.env.NODE_ENV === 'development' ? " 'unsafe-eval'" : ''
    }`,
    // Tailwind ships as a static stylesheet, but Next injects inline style
    // attributes (and next/font emits an inline <style>), so styles cannot
    // be nonce-only without breaking the first paint.
    `style-src 'self' 'unsafe-inline'`,
    // Google account avatars on the header menu and the public CV.
    `img-src 'self' data: https://lh3.googleusercontent.com https://*.googleusercontent.com`,
    `font-src 'self' data:`,
    // Sentry is tunnelled through /monitoring on this origin, so no
    // third-party connect target is needed.
    `connect-src 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ];

  const csp = directives.join('; ');

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  matcher: [
    /*
     * HTML documents only. Static assets, images and the Sentry tunnel do
     * not need a per-request nonce, and running middleware on them costs
     * an invocation each.
     */
    {
      source: '/((?!_next/static|_next/image|monitoring|favicon.ico|icon|apple-icon|opengraph-image|robots.txt|sitemap.xml).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
