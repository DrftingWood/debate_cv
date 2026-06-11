import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { classifyMotions, isClassifierConfigured } from '@/lib/tags/classifyMotions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// How many untagged motions one invocation classifies. Two Haiku batches —
// comfortably inside a serverless time budget; the admin clicks again (or
// later automates) to work through a larger backlog, and the response's
// `remaining` count says whether another pass is needed.
const MAX_MOTIONS_PER_RUN = 40;

// POST /api/admin/tags/classify — run the Haiku classifier over motions
// that are missing a type or topic, and file the suggestions as PENDING
// TagProposal rows authored by the requesting admin. Deliberately reuses
// the human proposal pipeline instead of writing canonical columns: the
// admin reviews classifier output on /admin/tags exactly like any user
// proposal, so a misclassification can't silently reach the analytics.
export async function POST() {
  let adminEmail: string;
  try {
    adminEmail = await requireAdmin();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  if (!isClassifierConfigured()) {
    return NextResponse.json({ error: 'classifier_not_configured' }, { status: 503 });
  }

  // Proposals need an authoring User row (TagProposal.userId is a real FK,
  // and the review UI shows the proposer). The admin allowlist is env-based,
  // so resolve the email back to their account.
  const adminUser = await prisma.user.findUnique({
    where: { email: adminEmail },
    select: { id: true },
  });
  if (!adminUser) {
    return NextResponse.json({ error: 'admin_user_not_found' }, { status: 400 });
  }

  const [motions, remainingTotal] = await Promise.all([
    prisma.motion.findMany({
      where: { OR: [{ motionType: null }, { topic: null }] },
      select: {
        id: true,
        tournamentId: true,
        text: true,
        infoSlide: true,
        motionType: true,
        topic: true,
      },
      orderBy: { id: 'asc' },
      take: MAX_MOTIONS_PER_RUN,
    }),
    prisma.motion.count({ where: { OR: [{ motionType: null }, { topic: null }] } }),
  ]);

  if (motions.length === 0) {
    return NextResponse.json({ classified: 0, proposalsFiled: 0, remaining: 0 });
  }

  const classifications = await classifyMotions(
    motions.map((m) => ({ id: m.id, text: m.text, infoSlide: m.infoSlide })),
  );

  const motionById = new Map(motions.map((m) => [m.id, m]));
  let proposalsFiled = 0;

  for (const c of classifications) {
    const motion = motionById.get(c.id);
    if (!motion) continue;
    // Only file for the dimension that's actually untagged — an approved
    // topic shouldn't get a competing classifier proposal.
    const wanted: Array<{ kind: string; value: string }> = [];
    if (motion.motionType == null) wanted.push({ kind: 'motion_type', value: c.motionType });
    if (motion.topic == null) wanted.push({ kind: 'motion_topic', value: c.topic });

    for (const { kind, value } of wanted) {
      // Same one-live-proposal-per-(user, kind, target) rule as
      // /api/tags/propose: re-running the classifier refreshes the admin's
      // existing suggestion instead of stacking duplicates in the queue.
      const existing = await prisma.tagProposal.findFirst({
        where: {
          userId: adminUser.id,
          kind,
          tournamentId: motion.tournamentId,
          motionId: motion.id,
        },
        select: { id: true },
      });
      if (existing) {
        await prisma.tagProposal.update({
          where: { id: existing.id },
          data: { value, status: 'pending', adminNote: null, reviewedAt: null },
        });
      } else {
        await prisma.tagProposal.create({
          data: {
            userId: adminUser.id,
            kind,
            tournamentId: motion.tournamentId,
            motionId: motion.id,
            value,
          },
        });
      }
      proposalsFiled += 1;
    }
  }

  return NextResponse.json({
    classified: classifications.length,
    proposalsFiled,
    remaining: Math.max(remainingTotal - motions.length, 0),
  });
}
