import { Prisma } from '@prisma/client';
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
 *
 * Concurrency: the dedupe check + create runs inside a Serializable
 * transaction so two concurrent writeNotification calls (e.g. cron and
 * drain both finishing a user's last job at the same instant) can't
 * both pass the check and both insert. Postgres aborts one of any two
 * transactions that would otherwise produce a duplicate; we catch the
 * 40001 serialization_failure and treat it as "the other transaction
 * won the race", which is the desired behaviour. The previous
 * findFirst-then-create implementation was racy and produced duplicate
 * "Your CV is ready" bells under concurrent ingest.
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
      try {
        await prisma.$transaction(
          async (tx) => {
            const recent = await tx.notification.findFirst({
              where: { userId, kind, createdAt: { gte: since } },
              select: { id: true },
            });
            if (recent) return;
            await tx.notification.create({
              data: { userId, kind, title, body, href },
            });
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (e: unknown) {
        // Postgres error 40001 (serialization_failure) means another tx
        // wrote a conflicting row first. That's the intended dedup outcome,
        // not a real failure — swallow and exit without re-throwing.
        const code = (e as { code?: string })?.code;
        if (code !== '40001' && code !== 'P2034') throw e;
      }
    } else {
      await prisma.notification.create({
        data: { userId, kind, title, body, href },
      });
    }
  } catch {
    // Outer best-effort swallow — a notification write must never break
    // the operation that triggered it.
  }
}
