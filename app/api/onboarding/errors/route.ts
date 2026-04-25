import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * List every URL where preflight tried but couldn't extract a name, with the
 * exact error message persisted on the row. Powers the "View errors" panel on
 * /onboarding so the user can see why a URL didn't appear in the names list.
 *
 * URL is reachable status: registrationName='' (preflight ran, no name).
 * Untouched URLs (registrationName=null) are excluded — those are still in
 * the queue, not failures.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const failures = await prisma.discoveredUrl.findMany({
    where: {
      userId,
      registrationName: '',
      registrationPersonId: null,
    },
    orderBy: { messageDate: 'desc' },
    select: {
      id: true,
      url: true,
      host: true,
      lastPreflightError: true,
    },
  });

  return NextResponse.json({
    failures: failures.map((f) => ({
      id: f.id,
      url: f.url,
      host: f.host,
      error: f.lastPreflightError ?? 'unknown error (no message recorded)',
    })),
  });
}
