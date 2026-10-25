import type { Prisma } from '@prisma/client';

export type ApprovableProposal = {
  id: string;
  kind: string;
  tournamentId: bigint;
  motionId: bigint | null;
  value: string;
};

/**
 * Approve one proposal inside a transaction: mark it approved, write the
 * value through to the canonical column, and approve other pending proposals
 * that say the same thing about the same target.
 *
 * Shared by the one-at-a-time route and the approve-all route so the two
 * can never disagree about what "approved" writes.
 *
 * Proposals with a DIFFERENT value for the same target stay pending: they
 * might be right under another reading (two valid regions for a borderline
 * tournament), so a human rejects those individually.
 */
export async function approveProposalTx(
  tx: Prisma.TransactionClient,
  proposal: ApprovableProposal,
  now: Date,
  adminNote: string | null = null,
): Promise<void> {
  await tx.tagProposal.update({
    where: { id: proposal.id },
    data: { status: 'approved', adminNote, reviewedAt: now },
  });

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

  await tx.tagProposal.updateMany({
    where: {
      id: { not: proposal.id },
      kind: proposal.kind,
      tournamentId: proposal.tournamentId,
      motionId: proposal.motionId ?? null,
      value: proposal.value,
      status: 'pending',
    },
    data: { status: 'approved', reviewedAt: now },
  });
}
