import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { MOTIONS_TODO, TOURNAMENTS_TODO, hostOf } from '@/lib/tags/todo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A ceiling, not an expectation: the whole backlog is a few thousand short
// lines, but an unbounded read has no place in a serverless handler.
const MAX_ROWS = 20_000;

/**
 * GET /api/admin/tags/export
 *
 * Everything that still needs a tag answer, as one JSON file the admin can
 * hand to someone (or something) that answers it without the app calling an
 * API: untagged motions with their text, and tournaments with no region.
 * The answers come back through POST /api/admin/tags/import, which files them
 * as pending proposals for the usual one-click review.
 *
 * Only public tournament data leaves here (names, hosts, motion text); ids
 * are strings because BigInt does not survive JSON.
 */
export async function GET() {
  try {
    await requireAdmin();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  const [motions, tournaments] = await Promise.all([
    prisma.motion.findMany({
      where: MOTIONS_TODO,
      select: {
        id: true,
        tournamentId: true,
        text: true,
        infoSlide: true,
        motionType: true,
        topic: true,
      },
      orderBy: { id: 'asc' },
      take: MAX_ROWS,
    }),
    prisma.tournament.findMany({
      where: TOURNAMENTS_TODO,
      select: { id: true, name: true, format: true, year: true, sourceUrlRaw: true },
      orderBy: { id: 'asc' },
      take: MAX_ROWS,
    }),
  ]);

  const body = {
    exportedAt: new Date().toISOString(),
    // Which dimensions are open, so the answerer does not re-answer a field
    // that is already tagged or already has a suggestion.
    motions: motions.map((m) => ({
      id: m.id.toString(),
      tournamentId: m.tournamentId.toString(),
      text: m.text,
      infoSlide: m.infoSlide,
      needsType: m.motionType == null,
      needsTopic: m.topic == null,
    })),
    tournaments: tournaments.map((t) => ({
      id: t.id.toString(),
      name: t.name,
      format: t.format,
      year: t.year,
      host: hostOf(t.sourceUrlRaw),
    })),
  };

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(body), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-disposition': `attachment; filename="untagged-${stamp}.json"`,
      'cache-control': 'no-store',
    },
  });
}
