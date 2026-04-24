import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { revokeAndForgetGmailToken } from '@/lib/gmail/client';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  // Require the user to type their email to confirm the destructive action.
  confirmEmail: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const parse = Body.safeParse(await req.json().catch(() => ({})));
    if (!parse.success) {
      return NextResponse.json(
        { error: 'bad_request', details: parse.error.flatten() },
        { status: 400 },
      );
    }

    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) return NextResponse.json({ error: 'not_found' }, { status: 404 });

    if (
      parse.data.confirmEmail.trim().toLowerCase() !==
      (user.email ?? '').toLowerCase()
    ) {
      return NextResponse.json({ error: 'email_mismatch' }, { status: 400 });
    }

    // Best-effort: revoke the OAuth grant before we drop the token row.
    await revokeAndForgetGmailToken(userId);

    // Cascade: User -> Account, Session, GmailToken, DiscoveredUrl, IngestJob,
    // PersonRejection via Prisma's onDelete: Cascade. Person rows get
    // claimedByUserId cleared via onDelete: SetNull.
    await prisma.user.delete({ where: { id: userId } });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[api/account/delete]', msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
