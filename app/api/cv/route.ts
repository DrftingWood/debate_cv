import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const persons = await prisma.person.findMany({
    where: { claimedByUserId: session.user.id },
    include: {
      participations: {
        include: {
          tournament: true,
          roles: true,
          speakerRoundScores: true,
        },
      },
    },
  });

  const cv = persons.flatMap((p) =>
    p.participations.map((part) => ({
      personName: p.displayName,
      tournament: {
        id: part.tournament.id.toString(),
        name: part.tournament.name,
        year: part.tournament.year,
        format: part.tournament.format,
        host: part.tournament.sourceHost,
        sourceUrl: part.tournament.sourceUrlRaw,
      },
      roles: part.roles.map((r) => r.role),
      teamName: part.teamName,
      speakerScoreTotal: part.speakerScoreTotal?.toString() ?? null,
      wins: part.wins,
      losses: part.losses,
      eliminationReached: part.eliminationReached,
      roundScores: part.speakerRoundScores.map((s) => ({
        roundNumber: s.roundNumber,
        positionLabel: s.positionLabel,
        score: s.score?.toString() ?? null,
      })),
    })),
  );

  return NextResponse.json({ cv });
}
