import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { revokeAndForgetGmailToken } from '@/lib/gmail/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;
    await revokeAndForgetGmailToken(userId);
    // Also drop any linked Google Account row so sign-in forces re-consent.
    await prisma.account.deleteMany({ where: { userId, provider: 'google' } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/account/disconnect]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
