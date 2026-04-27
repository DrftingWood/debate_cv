import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvCell(value: string | number | null | undefined): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function csvLine(values: Array<string | number | null | undefined>): string {
  return values.map(csvCell).join(',');
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const reports = await prisma.cvErrorReport.findMany({
    where: { userId: session.user.id },
    orderBy: { createdAt: 'desc' },
  });

  const tournamentIds = [...new Set(reports.flatMap((report) => report.tournamentIds))]
    .filter((id) => /^\d+$/.test(id));
  const tournaments = tournamentIds.length
    ? await prisma.tournament.findMany({
        where: { id: { in: tournamentIds.map((id) => BigInt(id)) } },
        select: { id: true, name: true, year: true },
      })
    : [];
  const tournamentById = new Map(tournaments.map((t) => [t.id.toString(), t] as const));

  const rows = [
    csvLine(['created_at', 'tournament_ids', 'tournaments', 'comment']),
    ...reports.map((report) => {
      const names = report.tournamentIds.map((id) => {
        const tournament = tournamentById.get(id);
        return tournament
          ? `${tournament.name}${tournament.year ? ` ${tournament.year}` : ''}`
          : `#${id}`;
      });
      return csvLine([
        report.createdAt.toISOString(),
        report.tournamentIds.join('; '),
        names.join('; '),
        report.comment,
      ]);
    }),
  ];

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(rows.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cv-error-reports-${date}.csv"`,
    },
  });
}
