import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { writeNotification } from '@/lib/notifications/write';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Release a Person's identity claim.
 *
 * The counterpart to POST /api/persons/[id]/claim. Before this existed a
 * wrongly-claimed identity — whether squatted deliberately or clicked by
 * mistake during onboarding — could only be undone with direct database
 * access, because the claim is first-come and the rightful owner just gets
 * a 409 forever.
 *
 * Admin-only on purpose: "this is actually me" is a judgement call between
 * two accounts, and the losing side of that call must not be able to make
 * it themselves. Users reach it by filing a `claimed_by_someone_else`
 * report, which lands in the admin queue.
 *
 * The previous holder is notified. Silently removing something from
 * someone's CV would be worse than the original problem.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json({ error: status === 403 ? 'forbidden' : 'unauthorized' }, { status });
  }

  const { id } = await params;
  let personId: bigint;
  try {
    personId = BigInt(id);
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: { id: true, displayName: true, claimedByUserId: true },
  });
  if (!person) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (!person.claimedByUserId) {
    // Idempotent: releasing an unclaimed identity is a no-op, not an error,
    // so a double-click from the admin queue doesn't 4xx.
    return NextResponse.json({ ok: true, released: false });
  }

  const previousHolder = person.claimedByUserId;
  await prisma.person.update({
    where: { id: personId },
    data: { claimedByUserId: null, claimedAt: null },
  });

  await writeNotification({
    userId: previousHolder,
    kind: 'identity_released',
    title: `"${person.displayName}" was removed from your record`,
    body:
      'An admin released this identity claim following a dispute. If you believe this was a mistake, reply to the report thread in Settings → Reports.',
    href: '/cv/verify',
  }).catch(() => {
    // A notification failure must not roll back the release itself.
  });

  return NextResponse.json({ ok: true, released: true, personId: personId.toString() });
}
