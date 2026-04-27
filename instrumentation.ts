/**
 * Next.js 15 server-instrumentation hook. Imported on server start to
 * load runtime-specific Sentry config. The dynamic imports below are
 * required — `sentry.server.config.ts` and `sentry.edge.config.ts`
 * have side effects (Sentry.init) that must only run in the matching
 * runtime, and Next.js bundles each runtime separately.
 */
import * as Sentry from '@sentry/nextjs';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
  if (process.env.NEXT_RUNTIME === 'edge') {
    await import('./sentry.edge.config');
  }
}

export const onRequestError = Sentry.captureRequestError;
