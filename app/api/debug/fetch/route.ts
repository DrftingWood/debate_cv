import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { probeFetch } from '@/lib/calicotab/fetch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Admin-only diagnostic probe. Paste a Tabbycat URL as `?url=…` to see
 * exactly what the Vercel runtime gets back — HTTP status, response
 * headers, and first 400 chars of the body. Essential for diagnosing
 * Cloudflare 403s and other upstream rejection modes.
 *
 * Access is gated by `ADMIN_EMAIL`: the signed-in user's email must match
 * (case-insensitive, comma-separated list supported).
 */
export async function GET(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }

    const adminEmails = (process.env.ADMIN_EMAIL ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
    if (!adminEmails.length || !adminEmails.includes(session.user.email.toLowerCase())) {
      return NextResponse.json({ error: 'forbidden' }, { status: 403 });
    }

    const url = new URL(req.url).searchParams.get('url');
    if (!url) {
      return NextResponse.json(
        { error: 'missing_url', hint: 'pass ?url=<absolute https URL>' },
        { status: 400 },
      );
    }
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      return NextResponse.json({ error: 'invalid_url' }, { status: 400 });
    }
    if (target.protocol !== 'https:' && target.protocol !== 'http:') {
      return NextResponse.json({ error: 'unsupported_protocol' }, { status: 400 });
    }

    const result = await probeFetch(target.toString());
    return NextResponse.json({
      url: target.toString(),
      ...result,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/debug/fetch]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
