import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin';
import { prisma } from '@/lib/db';
import { csvLine } from '@/lib/utils/csv';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    await requireAdmin();
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message }, { status: err.status ?? 500 });
  }

  const reports = await prisma.cvErrorReport.findMany({
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { name: true, email: true } } },
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
    csvLine([
      'created_at',
      'user_name',
      'user_email',
      'user_id',
      'tournament_ids',
      'tournaments',
      'categories',
      'comment',
      'status',
      'resolved_at',
    ]),
    ...reports.map((report) => {
      const names = report.tournamentIds.map((id) => {
        const tournament = tournamentById.get(id);
        return tournament
          ? `${tournament.name}${tournament.year ? ` ${tournament.year}` : ''}`
          : `#${id}`;
      });
      return csvLine([
        report.createdAt.toISOString(),
        report.user.name,
        report.user.email,
        report.userId,
        report.tournamentIds.join('; '),
        names.join('; '),
        report.categories.join('; '),
        report.comment,
        report.status,
        report.resolvedAt?.toISOString(),
      ]);
    }),
  ];

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(rows.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="cv-error-reports-admin-${date}.csv"`,
    },
  });
}
