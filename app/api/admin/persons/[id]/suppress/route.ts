import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { SUPPRESSED_DISPLAY_NAME } from '@/lib/privacy/suppression';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Erasure for a person who never signed up.
 *
 * Account deletion (`/api/account/delete`) covers users. It does not cover
 * the far larger group this product holds data about: everyone whose name,
 * team and speaker scores were scraped off a public tab and then surfaced
 * on someone else's CV as a teammate or an opponent. Those people are data
 * subjects too, and until this route existed the only answer to "take my
 * name off your site" was a manual UPDATE.
 *
 * Suppression masks rather than deletes — see lib/privacy/suppression.ts for
 * why. The row survives so the tournament record and the field statistics
 * computed from it stay intact; the NAME stops being published, stops being
 * claimable, and is never refreshed by a later re-ingest (both Person
 * upserts in lib/calicotab/ingest.ts and the one in
 * /api/onboarding/confirm skip a suppressed row).
 *
 * Admin-only, and deliberately manual: the request arrives by email from
 * someone with no account, so a human has to decide that the requester is
 * the person on the tab before pulling the trigger. Automating that would
 * hand anyone a button for erasing a stranger's record.
 *
 * POST suppresses, DELETE restores. Both are idempotent.
 */

async function loadPerson(idParam: string) {
  let personId: bigint;
  try {
    personId = BigInt(idParam);
  } catch {
    return { error: NextResponse.json({ error: 'bad_request' }, { status: 400 }) };
  }
  const person = await prisma.person.findUnique({
    where: { id: personId },
    select: {
      id: true,
      displayName: true,
      claimedByUserId: true,
      suppressedAt: true,
    },
  });
  if (!person) {
    return { error: NextResponse.json({ error: 'not_found' }, { status: 404 }) };
  }
  return { personId, person };
}

async function guardAdmin() {
  try {
    await requireAdmin();
    return null;
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    return NextResponse.json(
      { error: status === 403 ? 'forbidden' : 'unauthorized' },
      { status },
    );
  }
}

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardAdmin();
  if (denied) return denied;

  const { id } = await params;
  const loaded = await loadPerson(id);
  if (loaded.error) return loaded.error;
  const { personId, person } = loaded;

  // A claimed Person belongs to an account holder, and their erasure route
  // is account deletion — which also removes their session, tokens and
  // discovered URLs. Suppressing here instead would leave all of that in
  // place while quietly blanking their own CV, which is the worst of both.
  if (person.claimedByUserId) {
    return NextResponse.json(
      {
        error: 'claimed_person',
        reason:
          'This Person is claimed by an account. Ask the account holder to delete their account (Settings → Delete account), or release the claim first.',
      },
      { status: 409 },
    );
  }

  if (person.suppressedAt) {
    return NextResponse.json({
      ok: true,
      suppressed: true,
      changed: false,
      suppressedAt: person.suppressedAt.toISOString(),
    });
  }

  const now = new Date();
  await prisma.person.update({
    where: { id: personId },
    data: { suppressedAt: now },
  });

  return NextResponse.json({
    ok: true,
    suppressed: true,
    changed: true,
    suppressedAt: now.toISOString(),
    displayedAs: SUPPRESSED_DISPLAY_NAME,
  });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await guardAdmin();
  if (denied) return denied;

  const { id } = await params;
  const loaded = await loadPerson(id);
  if (loaded.error) return loaded.error;
  const { personId, person } = loaded;

  if (!person.suppressedAt) {
    return NextResponse.json({ ok: true, suppressed: false, changed: false });
  }

  await prisma.person.update({
    where: { id: personId },
    data: { suppressedAt: null },
  });

  return NextResponse.json({ ok: true, suppressed: false, changed: true });
}
