import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    await requireAdmin();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  // Delete in FK-safe leaf-first order.
  // Person and PersonRejection are intentionally preserved — user claims survive the wipe.
  const [
    eliminationResults,
    speakerRoundScores,
    participantRoles,
    teamResults,
    judgeAssignments,
    tournamentParticipants,
  ] = await Promise.all([
    prisma.eliminationResult.deleteMany(),
    prisma.speakerRoundScore.deleteMany(),
    prisma.participantRole.deleteMany(),
    prisma.teamResult.deleteMany(),
    prisma.judgeAssignment.deleteMany(),
    prisma.tournamentParticipant.deleteMany(),
  ]);

  // Reset DiscoveredUrl foreign keys before deleting Tournament rows.
  await prisma.discoveredUrl.updateMany({
    data: { ingestedAt: null, tournamentId: null, registrationPersonId: null },
  });

  const [tournaments, ingestJobs, parserRuns, sourceDocuments] = await Promise.all([
    prisma.tournament.deleteMany(),
    prisma.ingestJob.deleteMany(),
    prisma.parserRun.deleteMany(),
    prisma.sourceDocument.deleteMany(),
  ]);

  return NextResponse.json({
    cleared: {
      eliminationResults: eliminationResults.count,
      speakerRoundScores: speakerRoundScores.count,
      participantRoles: participantRoles.count,
      teamResults: teamResults.count,
      judgeAssignments: judgeAssignments.count,
      tournamentParticipants: tournamentParticipants.count,
      tournaments: tournaments.count,
      ingestJobs: ingestJobs.count,
      parserRuns: parserRuns.count,
      sourceDocuments: sourceDocuments.count,
    },
  });
}
