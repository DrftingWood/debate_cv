/**
 * Sentry verification endpoint. Throws an error so we can confirm:
 *   1. The error reaches Sentry (visible in the Issues tab).
 *   2. The stack trace resolves to TypeScript source, not minified output
 *      (proving source map upload worked at build time).
 *
 * Gated by `requireAdmin` so random visitors can't fill the Sentry
 * project's error budget. Hit it once after deploy by curl-ing the URL
 * while signed in as an admin (or via the browser).
 *
 * Safe to leave deployed — `requireAdmin` returns 401/403 to non-admins
 * and the throw is intentional, marked accordingly.
 */
import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }
  // Intentional throw — this is the verification path. The error message
  // includes a marker so you can recognise it in Sentry's Issues list.
  throw new Error('SentryVerificationError: this is the canary throw from /api/sentry-test');
}
