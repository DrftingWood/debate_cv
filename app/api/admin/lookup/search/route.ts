import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { hasPrivateKeyPath, publicFormOf } from '@/lib/admin/tabAddress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** The lookup route's own limit on what an admin can paste. */
const MAX_CHARS = 500;

/**
 * Where the search box submits without JavaScript (and on an Enter pressed
 * before it hydrates). The form posts, so the text travels in the request
 * body rather than the URL: a pasted private URL would otherwise sit in the
 * address bar, the history and the platform's request logs. This answers
 * 303 to the list page with a `q` that is safe to put in an address: the
 * text as typed, or for private text its public tab base, which has the
 * same host and slug and so finds the same tournament.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.redirect(new URL('/', req.url), 303);
  }
  const form = await req.formData().catch(() => null);
  const raw = form?.get('q');
  const text = typeof raw === 'string' ? raw.trim().slice(0, MAX_CHARS) : '';
  const q = hasPrivateKeyPath(text) ? (publicFormOf(text) ?? '') : text;
  return NextResponse.redirect(new URL(searchHref(q), req.url), 303);
}

function searchHref(q: string): string {
  return q ? `/admin/tournaments?q=${encodeURIComponent(q)}` : '/admin/tournaments';
}
