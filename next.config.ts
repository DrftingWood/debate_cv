import type { NextConfig } from 'next';
import { withSentryConfig } from '@sentry/nextjs';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()',
  },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
];

const config: NextConfig = {
  serverExternalPackages: ['@prisma/client', 'googleapis'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

// Sentry build-plugin wrap. Uploads source maps + creates releases at build
// time so production stack traces resolve to the original TypeScript instead
// of minified bundles. The `org` and `project` slugs are tied to the prod
// Sentry account; `SENTRY_AUTH_TOKEN` is the secret that authorises the
// upload (set on Vercel only — local dev builds run silently when missing).
export default withSentryConfig(config, {
  org: 'abhishek-acharya',
  project: 'javascript-nextjs-7q',
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Suppress build-plugin output unless we're in CI; locally the noise
  // doesn't help and obscures real Next.js build messages.
  silent: !process.env.CI,

  // Upload source maps from a wider client-side scope so async chunks
  // resolve too (default is too narrow for App Router).
  widenClientFileUpload: true,

  // Strip Sentry SDK's `console.log`/`console.warn` from prod bundles.
  disableLogger: true,

  // Skip Vercel's automatic Cron Monitoring instrumentation. We have one
  // cron route (/api/cron/process-queue) and we'll instrument it manually
  // if needed; auto-instrumentation can clash with our isAuthorized check.
  automaticVercelMonitors: false,
});
