import { prisma } from '@/lib/db';

/**
 * Write a notification for a user. Best-effort — failures are swallowed
 * (and Sentry'd by callers if they care) so a notification write can
 * never break the operation that triggered it (ingest, scan, etc.).
 *
 * `dedupeWithinMs` collapses identical (userId, kind) writes within the
 * window — useful for events that can fire many times in quick
 * succession (e.g. multiple ingest completions during the post-onboarding
 * batch); we don't want N bell entries for one logical event.
 */
export async function writeNotification(args: {
  userId: string;
  kind: string;
  title: string;
  body?: string;
  href?: string;
  dedupeWithinMs?: number;
}): Promise<void> {
  const { userId, kind, title, body, href, dedupeWithinMs } = args;
  try {
    if (dedupeWithinMs && dedupeWithinMs > 0) {
      const since = new Date(Date.now() - dedupeWithinMs);
      const recent = await prisma.notification.findFirst({
        where: { userId, kind, createdAt: { gte: since } },
        select: { id: true },
      });
      if (recent) return;
    }
    await prisma.notification.create({
      data: { userId, kind, title, body, href },
    });
  } catch {
    // Swallow — best-effort. The bell will simply miss this event.
  }
}
