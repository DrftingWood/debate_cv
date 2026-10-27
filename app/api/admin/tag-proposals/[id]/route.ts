import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { approveProposalTx } from '@/lib/tags/approve';

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
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
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

  // approve — the write-through and duplicate clean-up live in
  // lib/tags/approve.ts, shared with the approve-all route.
  await prisma.$transaction(async (tx) => {
    await approveProposalTx(tx, proposal, now, adminNote ?? null);
  });

  return NextResponse.json({ id, status: 'approved' });
}
