import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_STATUSES = ['pending', 'approved', 'rejected'] as const;
type ProposalStatus = (typeof VALID_STATUSES)[number];

/**
 * GET /api/admin/tag-proposals
 *
 * Returns the moderation queue. Default view is pending proposals; pass
 * ?status=approved or ?status=rejected to see resolved ones. We deliberately
 * keep all three in separate pages rather than one big table — the pending
 * queue is the action surface, and mixing in historical rows makes it hard to
 * see what still needs attention.
 *
 * Each row includes display context sourced inline:
 *   - user email (who proposed it)
 *   - tournament name (what tournament)
 *   - motion text (what motion, when motionId is set)
 *   - currentValue: what the canonical column holds RIGHT NOW so the reviewer
 *     can see at a glance whether someone already approved a conflicting value
 */
export async function GET(req: Request) {
  try {
    await requireAdmin();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  const { searchParams } = new URL(req.url);
  const statusParam = searchParams.get('status') ?? 'pending';

  if (!(VALID_STATUSES as readonly string[]).includes(statusParam)) {
    return NextResponse.json(
      { error: 'bad_request', reason: `status must be one of: ${VALID_STATUSES.join(', ')}` },
      { status: 400 },
    );
  }
  const status = statusParam as ProposalStatus;

  const rows = await prisma.tagProposal.findMany({
    where: { status },
    orderBy: { createdAt: 'asc' },
    include: {
      user: { select: { email: true } },
      tournament: { select: { name: true, region: true } },
      motion: { select: { text: true, motionType: true, topic: true } },
    },
  });

  const proposals = rows.map((row) => {
    // Derive the current canonical value for this proposal's target so the
    // reviewer immediately sees whether the field is already set or still null.
    let currentValue: string | null = null;
    if (row.kind === 'region') {
      currentValue = row.tournament.region ?? null;
    } else if (row.kind === 'motion_type') {
      currentValue = row.motion?.motionType ?? null;
    } else if (row.kind === 'motion_topic') {
      currentValue = row.motion?.topic ?? null;
    }

    return {
      id: row.id,
      kind: row.kind,
      value: row.value,
      status: row.status,
      adminNote: row.adminNote ?? null,
      createdAt: row.createdAt.toISOString(),
      userEmail: row.user.email ?? null,
      tournamentId: row.tournamentId.toString(),
      tournamentName: row.tournament.name,
      motionId: row.motionId !== null ? row.motionId.toString() : null,
      motionText: row.motion?.text ?? null,
      currentValue,
    };
  });

  return NextResponse.json({ proposals });
}
