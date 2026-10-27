import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { enforceRateLimit } from '@/lib/rateLimit';
import { isDiscoveryEnabled } from '@/lib/discovery/flag';
import { loadFound } from '@/lib/discovery/loader';
import { appearanceKey, MATCHER_VERSION, type FoundRow } from '@/lib/discovery/match';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Id = z.string().regex(/^\d{1,19}$/);

const Item = z.object({
  tournamentId: Id,
  personId: Id,
  /** confirm = "This is me"; reject = "Not me"; restore = undo either. */
  decision: z.enum(['confirm', 'reject', 'restore']),
});

const Body = z.object({ items: z.array(Item).min(1).max(50) });

type ItemT = z.infer<typeof Item>;

function refuse(error: string, reason: string, status = 409) {
  return NextResponse.json({ error, reason }, { status });
}

/**
 * Checks each decision against what the matcher shows the user right now, so
 * the route cannot be used to record a decision about an arbitrary
 * participation. All or nothing: one bad item refuses the batch.
 */
function validate(
  items: readonly ItemT[],
  rows: ReadonlyMap<string, FoundRow>,
  stored: ReadonlySet<string>,
): NextResponse | null {
  const confirms = items.filter((i) => i.decision === 'confirm');
  for (const item of items) {
    const key = appearanceKey(item.tournamentId, item.personId);
    const row = rows.get(key);
    if (item.decision === 'restore') {
      if (!stored.has(key)) return refuse('nothing_to_restore', 'There is no decision to undo.');
      continue;
    }
    if (!row && !(item.decision === 'reject' && stored.has(key))) {
      return refuse('not_a_candidate', 'That tournament is no longer in your list.');
    }
    if (item.decision === 'confirm' && row?.tier === 'blocked') {
      return refuse('blocked', 'That row clashes with one you marked as you, so it cannot be you.');
    }
  }
  // Bulk "This is me" is for Strong matches only; everything else needs a
  // look at each row (owner's rule: close names always need the user's tick).
  if (confirms.length > 1) {
    const weak = confirms.some(
      (i) => rows.get(appearanceKey(i.tournamentId, i.personId))?.tier !== 'strong',
    );
    if (weak) return refuse('bulk_strong_only', 'Only strong matches can be marked together.');
  }
  return null;
}

const STATUS: Record<ItemT['decision'], string> = {
  confirm: 'confirmed',
  reject: 'rejected',
  restore: 'candidate',
};

/**
 * The write for one decision. With the matcher's current row, the facts the
 * user saw (proximity, score, evidence and warnings) are stored alongside the
 * decision; without one (a stored decision the matcher no longer returns),
 * only the status changes.
 */
function writeOne(
  item: ItemT,
  { userId, rows, now }: { userId: string; rows: ReadonlyMap<string, FoundRow>; now: Date },
) {
  const ids = { tournamentId: BigInt(item.tournamentId), personId: BigInt(item.personId) };
  const where = { userId_tournamentId_personId: { userId, ...ids } };
  const status = STATUS[item.decision];
  const decidedAt = item.decision === 'restore' ? null : now;
  const row = rows.get(appearanceKey(item.tournamentId, item.personId));
  if (!row) return prisma.appearanceCandidate.update({ where, data: { status, decidedAt } });
  const facts = {
    status,
    decidedAt,
    proximity: row.proximity,
    score: row.score,
    evidence: [...row.evidence, ...row.warnings],
    blockReason: row.blockReason,
    matcherVersion: MATCHER_VERSION,
  };
  return prisma.appearanceCandidate.upsert({
    where,
    create: { userId, ...ids, ...facts },
    update: facts,
  });
}

/**
 * Record "This is me" / "Not me" decisions on the Found tab (phase 1).
 *
 * Read-only as far as the CV goes: this writes AppearanceCandidate rows and
 * nothing else. Behind the discovery flag (404 for everyone else, so the
 * route does not advertise itself). Limited to 50 decisions a day per user,
 * counted per item, enforced by the shared Postgres rate limiter.
 */
export async function POST(req: Request) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  if (!isDiscoveryEnabled(session.user?.email)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const parse = Body.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json(
      { error: 'bad_request', details: parse.error.flatten() },
      { status: 400 },
    );
  }
  // One decision per appearance per request; the last one wins.
  const byKey = new Map<string, ItemT>();
  for (const item of parse.data.items) {
    byKey.set(appearanceKey(item.tournamentId, item.personId), item);
  }
  const items = [...byKey.values()];

  const limited = await enforceRateLimit('discovery:decide', userId, items.length);
  if (limited) return limited;

  const [{ rows }, existing] = await Promise.all([
    loadFound(userId, session.user?.name ?? null),
    prisma.appearanceCandidate.findMany({
      where: {
        userId,
        OR: items.map((i) => ({
          tournamentId: BigInt(i.tournamentId),
          personId: BigInt(i.personId),
        })),
      },
      select: { tournamentId: true, personId: true },
    }),
  ]);
  const rowByKey = new Map(rows.map((r) => [r.key, r]));
  const stored = new Set(
    existing.map((e) => appearanceKey(String(e.tournamentId), String(e.personId))),
  );
  const refused = validate(items, rowByKey, stored);
  if (refused) return refused;

  // One transaction (DB-5): a batch is recorded whole or not at all.
  const now = new Date();
  await prisma.$transaction(items.map((item) => writeOne(item, { userId, rows: rowByKey, now })));

  return NextResponse.json({
    ok: true,
    results: items.map((i) => ({
      tournamentId: i.tournamentId,
      personId: i.personId,
      decision: i.decision,
    })),
  });
}
