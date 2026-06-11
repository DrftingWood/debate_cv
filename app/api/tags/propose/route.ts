import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { TAG_VALUES, type TagKind } from '@/lib/tags/vocabulary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Numeric-string coercion helper used in the schema and in the handler body.
// We keep tournamentId/motionId as strings in the API contract (BigInt doesn't
// round-trip through JSON.stringify) and convert to BigInt just before the DB
// calls. z.string().regex ensures the value is a safe integer string before
// we hand it to BigInt().
const numericString = z.string().regex(/^\d+$/, 'must be a numeric string');

const Body = z.object({
  kind: z.enum(['region', 'motion_type', 'motion_topic']),
  tournamentId: numericString,
  motionId: numericString.optional(),
  value: z.string().min(1),
});

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
  const { kind, tournamentId: tournamentIdStr, motionId: motionIdStr, value } = parse.data;

  // Vocabulary check: the value must be one of the approved strings for this
  // kind. Enforced here rather than in the DB column so vocabulary edits stay
  // a one-file change in lib/tags/vocabulary.ts.
  if (!(TAG_VALUES[kind as TagKind] as readonly string[]).includes(value)) {
    return NextResponse.json(
      { error: 'bad_request', reason: `value not in vocabulary for kind '${kind}'` },
      { status: 400 },
    );
  }

  // motionId coupling rules:
  //   region     — must NOT carry a motionId (it tags the tournament, not a motion)
  //   motion_*   — MUST carry a motionId
  if (kind === 'region' && motionIdStr !== undefined) {
    return NextResponse.json(
      { error: 'bad_request', reason: 'motionId must not be provided for kind region' },
      { status: 400 },
    );
  }
  if ((kind === 'motion_type' || kind === 'motion_topic') && motionIdStr === undefined) {
    return NextResponse.json(
      { error: 'bad_request', reason: 'motionId is required for motion_type and motion_topic' },
      { status: 400 },
    );
  }

  const tournamentId = BigInt(tournamentIdStr);
  const motionId = motionIdStr !== undefined ? BigInt(motionIdStr) : undefined;

  // Authorization: the tournament must appear on the caller's CV — i.e. a
  // DiscoveredUrl row that has been fully ingested (ingestedAt not null). We
  // don't want users proposing tags for tournaments they can't see, which would
  // let anyone enumerate tournament IDs and bulk-propose garbage.
  const owned = await prisma.discoveredUrl.findFirst({
    where: { userId, tournamentId, ingestedAt: { not: null } },
    select: { id: true },
  });
  if (!owned) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  // For motion kinds, the motion must exist and belong to this tournament.
  // Belt-and-suspenders against forged motionIds pointing at a different
  // tournament's motions.
  if (motionId !== undefined) {
    const motion = await prisma.motion.findFirst({
      where: { id: motionId, tournamentId },
      select: { id: true },
    });
    if (!motion) {
      return NextResponse.json({ error: 'not_found' }, { status: 404 });
    }
  }

  // One live proposal per (user, kind, target): look for an existing row and
  // update it back to pending rather than stacking duplicates. This keeps the
  // admin queue clean and makes the UI "re-propose" flow idempotent — the user
  // sees their updated value without wondering whether an old proposal is still
  // floating around.
  const existing = await prisma.tagProposal.findFirst({
    where: {
      userId,
      kind,
      tournamentId,
      motionId: motionId ?? null,
    },
    select: { id: true },
  });

  let proposalId: string;
  if (existing) {
    const updated = await prisma.tagProposal.update({
      where: { id: existing.id },
      data: {
        value,
        status: 'pending',
        adminNote: null,
        reviewedAt: null,
      },
      select: { id: true },
    });
    proposalId = updated.id;
  } else {
    const created = await prisma.tagProposal.create({
      data: {
        userId,
        kind,
        tournamentId,
        motionId: motionId ?? null,
        value,
      },
      select: { id: true },
    });
    proposalId = created.id;
  }

  return NextResponse.json({ id: proposalId, status: 'pending' });
}
