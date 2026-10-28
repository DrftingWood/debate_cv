import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { approveProposalTx } from '@/lib/tags/approve';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const Body = z.object({
  kind: z.enum(['region', 'motion_type', 'motion_topic']).optional(),
});

// How many proposals one request approves. Each runs in its own transaction
// (the same write-through as the one-at-a-time route), so a failure part-way
// leaves the earlier ones approved and the rest still pending, never a
// half-written proposal. The response's `approved` tells the caller whether
// to ask again for a bigger backlog.
const MAX_PER_REQUEST = 300;

/**
 * POST /api/admin/tag-proposals/approve-all
 *
 * Approve every pending proposal (optionally of one kind) in one go. This is
 * the "answers are ready, I only want to correct the odd one" path: the
 * classifier fills the queue and the admin reviews the list once, rejecting
 * the few that are wrong, instead of approving hundreds individually.
 */
export async function POST(req: Request) {
  try {
    await requireAdmin();
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

  const pending = await prisma.tagProposal.findMany({
    where: { status: 'pending', ...(parse.data.kind ? { kind: parse.data.kind } : {}) },
    orderBy: { createdAt: 'asc' },
    take: MAX_PER_REQUEST,
    select: { id: true, kind: true, tournamentId: true, motionId: true, value: true },
  });

  const now = new Date();
  let approved = 0;
  for (const proposal of pending) {
    await prisma.$transaction(async (tx) => {
      await approveProposalTx(tx, proposal, now);
    });
    approved += 1;
  }

  return NextResponse.json({ approved });
}
