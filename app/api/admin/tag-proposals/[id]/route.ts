import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  action: z.enum(['approve', 'reject']),
  // adminNote is shown back to the proposer — keep it bounded so it can't be
  // used to store unbounded content.
  adminNote: z.string().max(2000).optional(),
});

/**
 * POST /api/admin/tag-proposals/[id]
 *
 * Approve or reject a single tag proposal. Approve is the write-through path:
 * it updates the canonical column (Tournament.region / Motion.motionType /
 * Motion.topic) in the same transaction so there's never a window where the
 * proposal is approved but the tag isn't written.
 *
 * Auto-approve other pending proposals for the same (kind, tournamentId,
 * motionId) target that proposed the same value. This handles the common case
 * where N users all correctly tagged the same tournament — no need to force
 * the admin to click approve N times for identical values.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireAdmin();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  const { id } = await params;

  const parse = Body.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json(
      { error: 'bad_request', details: parse.error.flatten() },
      { status: 400 },
    );
  }
  const { action, adminNote } = parse.data;

  const proposal = await prisma.tagProposal.findUnique({
    where: { id },
    select: { id: true, kind: true, tournamentId: true, motionId: true, value: true, status: true },
  });
  if (!proposal) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const now = new Date();

  if (action === 'reject') {
    // Reject is simple: mark the proposal and optionally note why.
    // We deliberately do NOT touch the canonical columns — a rejected proposal
    // for a wrong value should not overwrite a previously-approved correct one.
    await prisma.tagProposal.update({
      where: { id },
      data: { status: 'rejected', adminNote: adminNote ?? null, reviewedAt: now },
    });
    return NextResponse.json({ id, status: 'rejected' });
  }

  // approve — write the canonical value and clean up duplicate proposals in
  // one transaction. The three update calls are independent of each other
  // because only one kind branch fires per proposal, so no lock-ordering
  // concern here. The updateMany for duplicates runs last to avoid reading
  // stale data after the main proposal row is already approved.
  await prisma.$transaction(async (tx) => {
    // (a) Mark THIS proposal approved.
    await tx.tagProposal.update({
      where: { id },
      data: { status: 'approved', adminNote: adminNote ?? null, reviewedAt: now },
    });

    // (b) Write the canonical value for whichever dimension was approved.
    if (proposal.kind === 'region') {
      await tx.tournament.update({
        where: { id: proposal.tournamentId },
        data: { region: proposal.value },
      });
    } else if (proposal.kind === 'motion_type') {
      await tx.motion.update({
        where: { id: proposal.motionId! },
        data: { motionType: proposal.value },
      });
    } else if (proposal.kind === 'motion_topic') {
      await tx.motion.update({
        where: { id: proposal.motionId! },
        data: { topic: proposal.value },
      });
    }

    // (c) Auto-approve other pending proposals for the same target that
    //     proposed the same value. Proposals with a DIFFERENT value remain
    //     pending so the admin can individually reject them — we don't want
    //     to silently reject a proposal that might have been correct under a
    //     different taxonomy (e.g. two valid regions for a borderline
    //     tournament).
    await tx.tagProposal.updateMany({
      where: {
        id: { not: id },
        kind: proposal.kind,
        tournamentId: proposal.tournamentId,
        motionId: proposal.motionId ?? null,
        value: proposal.value,
        status: 'pending',
      },
      data: { status: 'approved', reviewedAt: now },
    });
  });

  return NextResponse.json({ id, status: 'approved' });
}
