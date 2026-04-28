import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { normalizePersonName } from '@/lib/calicotab/fingerprint';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  names: z.array(z.string().min(1)).max(50),
});

/**
 * Onboarding confirm: takes the set of names the user picked as theirs and
 * makes the user's claim set match it.
 *
 *   - Names in the request are upserted + claimed for the user (idempotent).
 *   - Names that were visible in the picker (i.e. derived from the user's
 *     own DiscoveredUrls) but NOT in the request are unclaimed — this is
 *     how a user removes a wrong-identity claim that ingest previously
 *     auto-set. Limiting the unclaim scope to picker-visible names means a
 *     re-submission can't accidentally drop a claim that was added through
 *     some other path.
 *
 * Uses the same INSERT … ON CONFLICT DO UPDATE … COALESCE pattern as
 * linkRegistrationPerson so concurrent claim attempts can't deadlock and
 * an existing claim by another user is preserved.
 */
export async function POST(req: Request) {
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

  // Dedupe by normalized name and sort so concurrent runs touch unique-index
  // rows in a stable order (defence-in-depth against deadlocks).
  const unique = new Map<string, string>();
  for (const raw of parse.data.names) {
    const display = raw.trim();
    if (!display) continue;
    const norm = normalizePersonName(display);
    if (!norm) continue;
    if (!unique.has(norm)) unique.set(norm, display);
  }
  const sorted = [...unique.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );

  let claimed = 0;
  for (const [norm, display] of sorted) {
    const rows = await prisma.$queryRaw<{ id: bigint }[]>`
      INSERT INTO "Person" ("displayName", "normalizedName", "claimedByUserId")
      VALUES (${display}, ${norm}, ${userId})
      ON CONFLICT ("normalizedName")
      DO UPDATE SET
        "displayName" = EXCLUDED."displayName",
        "claimedByUserId" = COALESCE("Person"."claimedByUserId", EXCLUDED."claimedByUserId")
      RETURNING id
    `;
    if (rows[0]) claimed++;
  }

  // Unclaim: any Person currently claimed by this user whose normalized name
  // appeared in the picker (i.e. is one of their DiscoveredUrl registration
  // names) but wasn't ticked. Picker-derived scoping is mirrored from
  // /api/onboarding/names so the front-end and back-end agree on what the
  // user actually saw.
  const urls = await prisma.discoveredUrl.findMany({
    where: { userId },
    select: { registrationName: true },
  });
  const pickerNorms = new Set<string>();
  for (const u of urls) {
    const reg = (u.registrationName ?? '').trim();
    if (!reg) continue;
    const norm = normalizePersonName(reg);
    if (norm) pickerNorms.add(norm);
  }
  const requested = new Set(unique.keys());
  const toUnclaim = [...pickerNorms].filter((n) => !requested.has(n));
  let unclaimed = 0;
  if (toUnclaim.length > 0) {
    const result = await prisma.person.updateMany({
      where: {
        claimedByUserId: userId,
        normalizedName: { in: toUnclaim },
      },
      data: { claimedByUserId: null },
    });
    unclaimed = result.count;
  }

  return NextResponse.json({ claimed, unclaimed });
}
