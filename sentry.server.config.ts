/**
 * Server runtime (Node) Sentry init. Loaded by `instrumentation.ts` when
 * `NEXT_RUNTIME === 'nodejs'`. Reads the same DSN as the client side; the
 * DSN is public-by-design in Sentry's threat model.
 */
import * as Sentry from '@sentry/nextjs';

const dsn = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    ignoreErrors: [
      // Our fetch wrapper deliberately throws this on AbortController
      // timeout; we already record it as a `ParserRun` warning that
      // surfaces on /cv/verify. No need to alert in Sentry too.
      /^fetch timeout after \d+ms/,
    ],
  });
}
