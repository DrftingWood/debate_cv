import { NextResponse } from 'next/server';
import { z } from 'zod';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Closed list of structured report categories the modal exposes. Codes
 * (not human strings) so the admin queue can group on them stably and the
 * front-end can render localized labels independently.
 */
const REPORT_CATEGORIES = [
  'wrong_teammate',
  'wrong_speaker_rank',
  'wrong_speaker_average',
  'wrong_team_result',
  'wrong_outround',
  'wrong_identity',
  'other',
] as const;

const Body = z.object({
  tournamentIds: z.array(z.string().regex(/^\d+$/)).min(1).max(25),
  categories: z.array(z.enum(REPORT_CATEGORIES)).max(REPORT_CATEGORIES.length).default([]),
  comment: z.string().trim().max(4000).default(''),
}).refine(
  // At least one category OR a non-trivial comment must be present, so we
  // don't accept empty submissions.
  (v) => v.categories.length > 0 || v.comment.length >= 8,
  { message: 'Pick at least one category or write a comment.' },
);

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const parse = Body.safeParse(await req.json().catch(() => ({})));
  if (!parse.success) {
    return NextResponse.json({ error: 'bad_request', details: parse.error.flatten() }, { status: 400 });
  }

  const userId = session.user.id;
  const requested = [...new Set(parse.data.tournamentIds)];
  const owned = await prisma.discoveredUrl.findMany({
    where: {
      userId,
      tournamentId: { in: requested.map((id) => BigInt(id)) },
    },
    select: { tournamentId: true },
    distinct: ['tournamentId'],
  });
  const ownedIds = new Set(owned.map((row) => row.tournamentId?.toString()).filter(Boolean));
  const tournamentIds = requested.filter((id) => ownedIds.has(id));

  if (tournamentIds.length === 0) {
    return NextResponse.json({ error: 'no_accessible_tournaments' }, { status: 400 });
  }

  const report = await prisma.cvErrorReport.create({
    data: {
      userId,
      tournamentIds,
      categories: parse.data.categories,
      comment: parse.data.comment,
    },
    select: { id: true, createdAt: true },
  });

  return NextResponse.json({
    id: report.id,
    createdAt: report.createdAt.toISOString(),
    tournamentCount: tournamentIds.length,
  });
}
