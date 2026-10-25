import { NextResponse } from 'next/server';
import { z } from 'zod';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { classifyMotions, isClassifierConfigured } from '@/lib/tags/classifyMotions';
import { classifyTournamentRegions } from '@/lib/tags/classifyTournaments';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// How many untagged motions one invocation classifies. Two Haiku batches —
// comfortably inside a serverless time budget; the caller asks again (the
// admin button loops) and the response's `remaining` count says whether
// another pass is needed.
const MAX_MOTIONS_PER_RUN = 40;
// Tournaments are one short line each, so a run can take more of them.
const MAX_TOURNAMENTS_PER_RUN = 40;

// What still needs an answer. Filing a suggestion does NOT change
// Motion.motionType / topic or Tournament.region — only approval does — so
// "untagged" alone would select the same first batch on every call and a
// loop over the backlog would never finish. A dimension that already has any
// proposal (pending, or rejected by the admin) is left alone: pending is
// already an answer, and a rejected one must not be revived by a re-run.
const MOTIONS_TODO = {
  OR: [
    { motionType: null, tagProposals: { none: { kind: 'motion_type' } } },
    { topic: null, tagProposals: { none: { kind: 'motion_topic' } } },
  ],
};
const TOURNAMENTS_TODO = { region: null, tagProposals: { none: { kind: 'region' } } };

// Cursors: the last id of the previous pass. An item the model cannot answer
// (an "unsure" tournament, a motion missing from a failed batch) files no
// proposal and so stays "to do"; without a cursor it would be picked first
// on every pass and starve everything behind it.
const Body = z.object({
  motionAfter: z.string().regex(/^[0-9]+$/).optional(),
  tournamentAfter: z.string().regex(/^[0-9]+$/).optional(),
});

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

// POST /api/admin/tags/classify — run the Haiku classifier over motions that
// are missing a type or topic and tournaments missing a region, and file the
// suggestions as PENDING TagProposal rows authored by the requesting admin.
// Deliberately reuses the human proposal pipeline instead of writing
// canonical columns: the admin reviews the classifier's output on
// /admin/tags (approving the lot in one click, or rejecting the odd wrong
// one), so a misclassification can't silently reach the analytics.
export async function POST(req?: Request) {
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

  const cursors = Body.safeParse(req ? await req.json().catch(() => ({})) : {});
  if (!cursors.success) {
    return NextResponse.json({ error: 'bad_request', details: cursors.error.flatten() }, { status: 400 });
  }
  const motionWhere = (after?: bigint) => (after === undefined ? MOTIONS_TODO : { ...MOTIONS_TODO, id: { gt: after } });
  const tournamentWhere = (after?: bigint) =>
    after === undefined ? TOURNAMENTS_TODO : { ...TOURNAMENTS_TODO, id: { gt: after } };
  const motionAfter = cursors.data.motionAfter ? BigInt(cursors.data.motionAfter) : undefined;
  const tournamentAfter = cursors.data.tournamentAfter ? BigInt(cursors.data.tournamentAfter) : undefined;

  const [motions, tournaments] = await Promise.all([
    prisma.motion.findMany({
      where: motionWhere(motionAfter),
      select: {
        id: true,
        tournamentId: true,
        text: true,
        infoSlide: true,
        motionType: true,
        topic: true,
        tagProposals: { select: { kind: true } },
      },
      orderBy: { id: 'asc' },
      take: MAX_MOTIONS_PER_RUN,
    }),
    prisma.tournament.findMany({
      where: tournamentWhere(tournamentAfter),
      select: { id: true, name: true, format: true, year: true, sourceUrlRaw: true },
      orderBy: { id: 'asc' },
      take: MAX_TOURNAMENTS_PER_RUN,
    }),
  ]);

  if (motions.length === 0 && tournaments.length === 0) {
    return NextResponse.json({
      classified: 0,
      proposalsFiled: 0,
      remaining: 0,
      regionsFiled: 0,
      regionsRemaining: 0,
      motionCursor: null,
      tournamentCursor: null,
    });
  }

  // Same one-live-proposal-per-(user, kind, target) rule as
  // /api/tags/propose: if the admin already has a proposal for this target,
  // refresh it instead of stacking a duplicate.
  const file = async (kind: string, tournamentId: bigint, motionId: bigint | null, value: string) => {
    const existing = await prisma.tagProposal.findFirst({
      where: { userId: adminUser.id, kind, tournamentId, motionId },
      select: { id: true },
    });
    if (existing) {
      await prisma.tagProposal.update({
        where: { id: existing.id },
        data: { value, status: 'pending', adminNote: null, reviewedAt: null },
      });
    } else {
      await prisma.tagProposal.create({
        data: { userId: adminUser.id, kind, tournamentId, motionId, value },
      });
    }
  };

  let classified = 0;
  let proposalsFiled = 0;
  if (motions.length > 0) {
    const classifications = await classifyMotions(
      motions.map((m) => ({ id: m.id, text: m.text, infoSlide: m.infoSlide })),
    );
    classified = classifications.length;

    const motionById = new Map(motions.map((m) => [m.id, m]));
    for (const c of classifications) {
      const motion = motionById.get(c.id);
      if (!motion) continue;
      // Only file for a dimension that is untagged AND has no proposal yet —
      // an approved topic shouldn't get a competing classifier proposal, and
      // a pending or rejected one is already someone's answer.
      const has = new Set((motion.tagProposals ?? []).map((p) => p.kind));
      if (motion.motionType == null && !has.has('motion_type')) {
        await file('motion_type', motion.tournamentId, motion.id, c.motionType);
        proposalsFiled += 1;
      }
      if (motion.topic == null && !has.has('motion_topic')) {
        await file('motion_topic', motion.tournamentId, motion.id, c.topic);
        proposalsFiled += 1;
      }
    }
  }

  let regionsFiled = 0;
  if (tournaments.length > 0) {
    const regions = await classifyTournamentRegions(
      tournaments.map((t) => ({
        id: t.id,
        name: t.name,
        format: t.format,
        year: t.year,
        host: hostOf(t.sourceUrlRaw),
      })),
    );
    for (const r of regions) {
      await file('region', r.id, null, r.region);
      regionsFiled += 1;
    }
  }

  // What is left after this batch's last id, so the caller can tell when to stop.
  const lastMotion = motions.length > 0 ? motions[motions.length - 1].id : null;
  const lastTournament = tournaments.length > 0 ? tournaments[tournaments.length - 1].id : null;
  const [remaining, regionsRemaining] = await Promise.all([
    lastMotion === null ? 0 : prisma.motion.count({ where: motionWhere(lastMotion) }),
    lastTournament === null ? 0 : prisma.tournament.count({ where: tournamentWhere(lastTournament) }),
  ]);

  return NextResponse.json({
    classified,
    proposalsFiled,
    remaining,
    regionsFiled,
    regionsRemaining,
    motionCursor: lastMotion === null ? null : lastMotion.toString(),
    tournamentCursor: lastTournament === null ? null : lastTournament.toString(),
  });
}
