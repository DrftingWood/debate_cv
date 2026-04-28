import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/notifications/mark-read
 * Marks every unread notification for the current user as read. Called
 * when the bell panel opens — there's no per-row "mark as read" workflow
 * since all the panel does is display, and unread === "user hasn't seen
 * the panel since this arrived".
 */
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const result = await prisma.notification.updateMany({
    where: { userId: session.user.id, readAt: null },
    data: { readAt: new Date() },
  });
  return NextResponse.json({ markedRead: result.count });
}
