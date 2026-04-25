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
  const userId = session.user.id;

  const jobs = await prisma.ingestJob.findMany({
    where: {
      userId,
      OR: [{ status: 'failed' }, { lastError: { not: null } }],
    },
    orderBy: { scheduledAt: 'desc' },
  });

  // Cross-reference DiscoveredUrl → tournament so each entry has a human-
  // readable tournament name when one exists.
  const tournamentByUrl = new Map<string, { name: string; year: number | null }>();
  if (jobs.length > 0) {
    const discovered = await prisma.discoveredUrl.findMany({
      where: { userId, url: { in: jobs.map((j) => j.url) } },
      include: { tournament: { select: { name: true, year: true } } },
    });
    for (const d of discovered) {
      if (d.tournament) tournamentByUrl.set(d.url, d.tournament);
    }
  }

  const fmt = (d: Date | null) => (d ? d.toISOString() : '—');
  const lines: string[] = [];
  lines.push(`Ingest errors export — ${new Date().toISOString()}`);
  lines.push(`User: ${session.user.email ?? userId}`);
  lines.push(`Entries: ${jobs.length}`);
  lines.push('='.repeat(80));
  lines.push('');

  for (const j of jobs) {
    const t = tournamentByUrl.get(j.url);
    lines.push(`URL:        ${j.url}`);
    lines.push(`Tournament: ${t ? `${t.name}${t.year ? ` (${t.year})` : ''}` : '— (not linked)'}`);
    lines.push(`Status:     ${j.status}`);
    lines.push(`Attempts:   ${j.attempts}`);
    lines.push(`Scheduled:  ${fmt(j.scheduledAt)}`);
    lines.push(`Started:    ${fmt(j.startedAt)}`);
    lines.push(`Finished:   ${fmt(j.finishedAt)}`);
    lines.push('Error / warnings:');
    lines.push(j.lastError ?? '(none recorded)');
    lines.push('-'.repeat(80));
    lines.push('');
  }

  if (jobs.length === 0) {
    lines.push('No failed jobs and no jobs with recorded warnings.');
  }

  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(lines.join('\n'), {
    status: 200,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'content-disposition': `attachment; filename="ingest-errors-${date}.txt"`,
    },
  });
}
