import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { getOAuthClientForUser } from '@/lib/gmail/client';
import { extractAllFromGmail } from '@/lib/gmail/run';
import { enqueueUrl } from '@/lib/queue';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const oauth = await getOAuthClientForUser(userId);
  if (!oauth) {
    return NextResponse.json(
      { error: 'no_gmail_token', hint: 'Re-sign in with Google to grant Gmail access.' },
      { status: 400 },
    );
  }

  const summary = await extractAllFromGmail(oauth);

  for (const r of summary.urls) {
    await prisma.discoveredUrl.upsert({
      where: { userId_url: { userId, url: r.url } },
      update: {
        subject: r.subject,
        messageId: r.messageId,
        messageDate: r.messageDate ? new Date(r.messageDate) : null,
      },
      create: {
        userId,
        url: r.url,
        host: r.host,
        tournamentSlug: r.tournamentSlug,
        token: r.token,
        subject: r.subject,
        messageId: r.messageId,
        messageDate: r.messageDate ? new Date(r.messageDate) : null,
      },
    });
    await enqueueUrl(userId, r.url);
  }

  return NextResponse.json({
    scanned: summary.scanned,
    found: summary.total,
    perHost: summary.perHost,
    perTournament: summary.perTournament,
  });
}
