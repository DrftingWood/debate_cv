import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { buildCvData } from '@/lib/cv/buildCvData';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(',');
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const data = await buildCvData(session.user.id);

  const lines = [
    csvLine([
      'section',
      'tournament',
      'year',
      'format',
      'teams',
      'my_name',
      'teammates',
      'team',
      'team_rank',
      'team_points',
      'speaker_average',
      'prelims_spoken',
      'speaker_rank',
      'broken',
      'last_outround_spoken',
      'judge_type',
      'inrounds_judged',
      'inrounds_chaired',
      'last_outround_chaired',
      'last_outround_judged',
    ]),
  ];

  for (const r of data.speakerRows) {
    const speakerRanks = [
      r.speakerRankOpen != null ? `#${r.speakerRankOpen} Open` : null,
      r.speakerRankEsl != null ? `#${r.speakerRankEsl} ESL` : null,
      r.speakerRankEfl != null ? `#${r.speakerRankEfl} EFL` : null,
    ]
      .filter(Boolean)
      .join(' | ');
    lines.push(
      csvLine([
        'speaker',
        r.tournamentName,
        r.year,
        r.format,
        r.totalTeams,
        r.myName,
        r.teammates.join(' | '),
        r.teamName,
        r.teamRank != null ? `#${r.teamRank}` : '',
        r.teamPoints ?? (r.teamWins != null ? `${r.teamWins}W` : ''),
        r.speakerAvgScore,
        r.prelimsSpoken || '',
        speakerRanks,
        r.broke ? 'Yes' : 'No',
        // Append "(W)" when the user's team won this outround AND the outround
        // was the tournament final, i.e. they won the tournament. Lets the CSV
        // distinguish champions from grand-finalists without an extra column.
        // EUDC dual-break case: render every category's deepest outround.
        (() => {
          const multi = r.eliminationReachedByCategory;
          if (multi && multi.length > 1) {
            const joined = multi.map((e) => `${e.category}: ${e.stage}`).join(' · ');
            return r.wonTournament === true ? `${joined} (W)` : joined;
          }
          if (!r.eliminationReached) return '';
          return r.wonTournament === true
            ? `${r.eliminationReached} (W)`
            : r.eliminationReached;
        })(),
        '',
        '',
        '',
        '',
        '',
      ]),
    );
  }

  for (const r of data.judgeRows) {
    lines.push(
      csvLine([
        'judge',
        r.tournamentName,
        r.year,
        r.format,
        r.totalTeams,
        r.myName,
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        r.broke ? 'Yes' : 'No',
        '',
        r.judgeTypeTag,
        r.inroundsJudged ?? '',
        r.inroundsChaired ?? '',
        r.lastOutroundChaired,
        r.lastOutroundJudged,
      ]),
    );
  }

  const filename = `debate-cv-${new Date().toISOString().slice(0, 10)}.csv`;
  return new NextResponse(lines.join('\n') + '\n', {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
