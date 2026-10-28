import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { MOTION_TOPICS, MOTION_TYPES, REGIONS } from '@/lib/tags/vocabulary';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const numericId = z.string().regex(/^[0-9]+$/);
const MAX_ITEMS = 20_000;

// Validated against the vocabulary here, before anything is read or written:
// the file is typed by hand or by a model, so a value outside the lists must
// fail loudly rather than reach the review queue.
const Body = z.object({
  motions: z
    .array(
      z.object({
        id: numericId,
        motionType: z.enum(MOTION_TYPES).optional(),
        topic: z.enum(MOTION_TOPICS).optional(),
      }),
    )
    .max(MAX_ITEMS)
    .default([]),
  tournaments: z
    .array(z.object({ id: numericId, region: z.enum(REGIONS).optional() }))
    .max(MAX_ITEMS)
    .default([]),
});

type NewProposal = {
  userId: string;
  kind: 'region' | 'motion_type' | 'motion_topic';
  tournamentId: bigint;
  motionId: bigint | null;
  value: string;
};

/**
 * POST /api/admin/tags/import
 *
 * Takes answers prepared outside the app (see GET /api/admin/tags/export) and
 * files them as PENDING proposals authored by the admin, exactly as the
 * classifier does: nothing here writes a canonical column, so the usual
 * review (reject the odd wrong row, approve the rest) still stands between an
 * answer and the CV.
 *
 * Idempotent and conservative: a dimension that is already tagged, or that
 * already has any proposal (pending, or rejected and so decided), is skipped,
 * so loading the same file twice, or after some tags were approved by hand,
 * files nothing twice.
 */
export async function POST(req: Request) {
  let adminEmail: string;
  try {
    adminEmail = await requireAdmin();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  const parse = Body.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json(
      { error: 'bad_request', details: z.flattenError(parse.error) },
      { status: 400 },
    );
  }
  const { motions: motionAnswers, tournaments: tournamentAnswers } = parse.data;

  const adminUser = await prisma.user.findUnique({
    where: { email: adminEmail },
    select: { id: true },
  });
  if (!adminUser) {
    return NextResponse.json({ error: 'admin_user_not_found' }, { status: 400 });
  }

  const [motions, tournaments] = await Promise.all([
    motionAnswers.length
      ? prisma.motion.findMany({
          where: { id: { in: motionAnswers.map((m) => BigInt(m.id)) } },
          select: {
            id: true,
            tournamentId: true,
            motionType: true,
            topic: true,
            tagProposals: { select: { kind: true } },
          },
        })
      : Promise.resolve([]),
    tournamentAnswers.length
      ? prisma.tournament.findMany({
          where: { id: { in: tournamentAnswers.map((t) => BigInt(t.id)) } },
          select: { id: true, region: true, tagProposals: { select: { kind: true } } },
        })
      : Promise.resolve([]),
  ]);
  const motionById = new Map(motions.map((m) => [m.id.toString(), m]));
  const tournamentById = new Map(tournaments.map((t) => [t.id.toString(), t]));

  const data: NewProposal[] = [];
  let requested = 0;

  for (const a of motionAnswers) {
    const motion = motionById.get(a.id);
    const has = new Set((motion?.tagProposals ?? []).map((p) => p.kind));
    if (a.motionType) {
      requested += 1;
      if (motion && motion.motionType == null && !has.has('motion_type')) {
        data.push({
          userId: adminUser.id,
          kind: 'motion_type',
          tournamentId: motion.tournamentId,
          motionId: motion.id,
          value: a.motionType,
        });
      }
    }
    if (a.topic) {
      requested += 1;
      if (motion && motion.topic == null && !has.has('motion_topic')) {
        data.push({
          userId: adminUser.id,
          kind: 'motion_topic',
          tournamentId: motion.tournamentId,
          motionId: motion.id,
          value: a.topic,
        });
      }
    }
  }
  for (const a of tournamentAnswers) {
    if (!a.region) continue;
    requested += 1;
    const t = tournamentById.get(a.id);
    const has = new Set((t?.tagProposals ?? []).map((p) => p.kind));
    if (t && t.region == null && !has.has('region')) {
      data.push({
        userId: adminUser.id,
        kind: 'region',
        tournamentId: t.id,
        motionId: null,
        value: a.region,
      });
    }
  }

  if (data.length > 0) {
    await prisma.tagProposal.createMany({ data });
  }
  return NextResponse.json({ filed: data.length, skipped: requested - data.length });
}
