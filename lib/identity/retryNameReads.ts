import { prisma } from '@/lib/db';
import {
  nameSample,
  NAME_READ_RETRY_AFTER_MS,
  RETRYABLE_READ_FAILURES,
} from '@/lib/identity/nameSample';

/**
 * Put a user's failed name reads back to unread, so onboarding reads those
 * private-URL pages again (2026-10-30: calicotab timeouts left new users
 * with every read failed and an empty name list, and nothing in the app
 * re-read them).
 *
 * Only while the name is unsettled (no claimed name, sample incomplete),
 * only failures that may pass (RETRYABLE_READ_FAILURES), and only those at
 * least NAME_READ_RETRY_AFTER_MS old: within one visit a page that just
 * timed out is not retried, so the onboarding loop still ends. Returns how
 * many links were reset.
 */
export async function resetRetryableNameReads(userId: string): Promise<number> {
  const claimed = await prisma.person.count({ where: { claimedByUserId: userId } });
  if (claimed > 0) return 0;
  const read = await prisma.discoveredUrl.findMany({
    where: { userId, registrationName: { not: null } },
    select: { registrationName: true },
  });
  if (nameSample(read.map((r) => r.registrationName)).complete) return 0;
  const { count } = await prisma.discoveredUrl.updateMany({
    where: {
      userId,
      registrationName: '',
      registrationPersonId: null,
      updatedAt: { lt: new Date(Date.now() - NAME_READ_RETRY_AFTER_MS) },
      OR: RETRYABLE_READ_FAILURES.map((prefix) => ({ lastPreflightError: { startsWith: prefix } })),
    },
    data: { registrationName: null, lastPreflightError: null },
  });
  return count;
}
