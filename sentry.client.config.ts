/**
 * Browser-side Sentry init. Loaded automatically by `withSentryConfig` in
 * next.config.ts when `NEXT_PUBLIC_SENTRY_DSN` is set. Skipped silently
 * when the DSN is missing (e.g. local dev without a Sentry project) so
 * a developer's local environment doesn't error on missing config.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    // Sample 10% of transactions for performance monitoring. Free tier
    // allows ~10k transactions/month — adjust if we approach the cap.
    tracesSampleRate: 0.1,
    // Quiet noise we already account for elsewhere or that's a known
    // browser-quirk false-positive.
    ignoreErrors: [
      // Common in apps with charts / observers; not a real bug.
      'ResizeObserver loop limit exceeded',
      'ResizeObserver loop completed with undelivered notifications',
      // User-cancelled fetches during navigation; not actionable.
      'AbortError',
    ],
  });
}
