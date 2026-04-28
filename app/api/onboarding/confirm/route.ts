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
 * Onboarding confirm: take the names the user picked as theirs and atomically
 * upsert + claim a Person row for each. Idempotent — re-running with the
 * same names is a no-op. Names not in the request that this user previously
 * claimed are *not* unclaimed; the user removes claims via /cv if needed.
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

  return NextResponse.json({ claimed });
}
