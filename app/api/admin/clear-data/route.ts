import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/admin/clear-data           — clear scraped tournament data only.
 * POST /api/admin/clear-data?full=1    — also wipe DiscoveredUrl, Person, and
 *                                        PersonRejection rows (a complete reset
 *                                        across all users; Gmail tokens stay
 *                                        so users only need to re-run the scan).
 *
 * The default mode preserves user identity claims so re-ingesting parses
 * existing claims back into the new tournament rows. The `full=1` mode is
 * for testing the discovery + claim flow from zero.
 */
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  const full = new URL(req.url).searchParams.get('full') === '1';

  // Delete in FK-safe leaf-first order.
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

  // Reset DiscoveredUrl foreign keys before deleting Tournament rows so the
  // Tournament delete doesn't violate the FK. In full mode the URLs themselves
  // are deleted right after, but the reset is still needed to detach them from
  // Person rows (registrationPersonId) which we delete next.
  await prisma.discoveredUrl.updateMany({
    data: { ingestedAt: null, tournamentId: null, registrationPersonId: null },
  });

  const [tournaments, ingestJobs, parserRuns, sourceDocuments] = await Promise.all([
    prisma.tournament.deleteMany(),
    prisma.ingestJob.deleteMany(),
    prisma.parserRun.deleteMany(),
    prisma.sourceDocument.deleteMany(),
  ]);

  let discoveredUrls = 0;
  let personRejections = 0;
  let persons = 0;
  if (full) {
    // Order: discoveredUrls → personRejections → persons. PersonRejection
    // FK-references Person; clear it before deleting Persons. DiscoveredUrl
    // has a `registrationPersonId` (already nulled above) plus a `userId`
    // that points to User — we don't touch User here.
    const dr = await prisma.discoveredUrl.deleteMany();
    const pr = await prisma.personRejection.deleteMany();
    const p = await prisma.person.deleteMany();
    discoveredUrls = dr.count;
    personRejections = pr.count;
    persons = p.count;
  }

  return NextResponse.json({
    mode: full ? 'full' : 'standard',
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
      ...(full
        ? {
            discoveredUrls,
            personRejections,
            persons,
          }
        : {}),
    },
  });
}
