import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { enforceRateLimit } from '@/lib/rateLimit';
import { prisma } from '@/lib/db';
import { personNameMatches } from '@/lib/calicotab/personMatch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Claim a Person as yourself.
 *
 * Two independent checks, because the first one alone was too weak:
 *
 *  1. **Attendance** — the Person must be at a tournament you ingested a
 *     private URL for. This was the only check, and it proves you were at
 *     the event while granting the right to claim ANY of the (often 800+)
 *     people there. On a credentialing product that means fabricating a
 *     WUDC octofinalist record, and because the claim is first-come the
 *     squatter also locks the real person out permanently.
 *
 *  2. **Identity** — the Person's name must match a name you can already
 *     demonstrate is yours: the registration name on one of your private
 *     URLs for that tournament (which the preflight step extracts from the
 *     landing page), or the name on your Google account. Matching is fuzzy
 *     via personNameMatches, so middle names, parentheticals and
 *     surname-first orderings still pass.
 *
 * Check 2 is not unbypassable — someone could rename their Google profile
 * — but it turns a trivial, invisible attack into a deliberate and
 * traceable one, and `claimedAt` records when each claim happened.
 * Genuine mismatches (a nickname on the tab, a changed legal name) go
 * through the dispute route rather than being silently allowed.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const limited = await enforceRateLimit('persons:claim', session.user.id);
  if (limited) return limited;
  const { id } = await params;
  let personId: bigint;
  try {
    personId = BigInt(id);
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  // ── 1. Attendance ────────────────────────────────────────────────────
  // Pull the tournaments this Person appears at that the user has also
  // ingested, so the identity check below can read the registration names
  // from exactly those URLs.
  const participations = await prisma.tournamentParticipant.findMany({
    where: {
      personId,
      tournament: {
        discoveredUrls: { some: { userId: session.user.id } },
      },
    },
    select: {
      tournamentId: true,
      person: { select: { displayName: true, suppressedAt: true } },
    },
  });
  if (participations.length === 0) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  // A suppressed Person has asked to be erased. Their row survives so the
  // event record and the field statistics stay intact, but nobody may take
  // it over — including, deliberately, someone who could pass the identity
  // check below, since a claim would republish the name.
  if (participations[0].person.suppressedAt) {
    return NextResponse.json(
      {
        error: 'name_withdrawn',
        reason:
          'This person has asked to be removed from the site. Their record cannot be claimed. If this is your own record, contact us and we will restore it.',
      },
      { status: 403 },
    );
  }

  // ── 2. Identity ──────────────────────────────────────────────────────
  const personName = participations[0].person.displayName;
  const tournamentIds = [...new Set(participations.map((p) => p.tournamentId))];

  const myUrls = await prisma.discoveredUrl.findMany({
    where: {
      userId: session.user.id,
      tournamentId: { in: tournamentIds },
      registrationName: { not: null },
    },
    select: { registrationName: true },
  });

  const candidateNames = [
    ...myUrls.map((u) => u.registrationName ?? ''),
    // The Google account name is a second signal for users whose preflight
    // never ran or whose private URL has since died, so a dead link does
    // not lock someone out of their own record.
    session.user.name ?? '',
  ].filter((n) => n.trim().length > 0);

  const identityMatches = candidateNames.some((name) => personNameMatches(name, personName));
  if (!identityMatches) {
    return NextResponse.json(
      {
        error: 'identity_mismatch',
        reason:
          candidateNames.length === 0
            ? 'We could not read the name on your private URL for this tournament. Run the import preflight, then try again.'
            : `"${personName}" does not match the name on your private URL or your account. If this is you under a different name, file a report and an admin will review it.`,
      },
      { status: 403 },
    );
  }

  // Single conditional updateMany prevents the read-then-write race that
  // produced 40P01 deadlocks under concurrent claim attempts. The OR clause
  // makes idempotent reclaim by the same user a no-op.
  const updated = await prisma.person.updateMany({
    where: {
      id: personId,
      suppressedAt: null,
      OR: [{ claimedByUserId: null }, { claimedByUserId: session.user.id }],
    },
    data: { claimedByUserId: session.user.id, claimedAt: new Date() },
  });
  if (updated.count === 0) {
    return NextResponse.json({ error: 'already_claimed_by_other' }, { status: 409 });
  }
  return NextResponse.json({ ok: true, personId: personId.toString() });
}
