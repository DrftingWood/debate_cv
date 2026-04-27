/**
 * Edge-runtime Sentry init (middleware, edge API routes). Loaded by
 * `instrumentation.ts` when `NEXT_RUNTIME === 'edge'`. We don't currently
 * run anything in the edge runtime, but this is wired up so adding edge
 * handlers later doesn't silently lose error reporting.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
  });
}
