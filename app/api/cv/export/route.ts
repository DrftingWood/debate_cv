import { NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { normalizePersonName } from '@/lib/calicotab/fingerprint';
import { classifyRoundLabel, deepestOutroundAcrossRoles } from '@/lib/calicotab/judgeStats';
import { mergeSpeakerCvSignals } from '@/lib/cv/speakerSignals';
import { buildTeamRankLookup, teamResultKey } from '@/lib/cv/teamRanks';

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

function numberOrNull(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function speakerAverage(participant: {
  speakerScoreTotal: { toString(): string } | null;
  speakerRoundScores: Array<{
    roundNumber: number;
    positionLabel: string | null;
    score: { toString(): string } | null;
  }>;
}): { average: string | null; prelims: number } {
  const averageScore = participant.speakerRoundScores.find(
    (s) => s.roundNumber === 0 || s.positionLabel === 'average',
  );
  const averageValue = numberOrNull(averageScore?.score);
  if (averageValue != null) return { average: averageValue.toFixed(1), prelims: 0 };

  const scores = participant.speakerRoundScores
    .filter((s) => s.roundNumber !== 0 && s.positionLabel !== 'average')
    .map((s) => numberOrNull(s.score))
    .filter((n): n is number => n != null);
  if (scores.length === 0) return { average: null, prelims: 0 };

  const total = numberOrNull(participant.speakerScoreTotal);
  const sum = total ?? scores.reduce((a, b) => a + b, 0);
  return { average: (sum / scores.length).toFixed(1), prelims: scores.length };
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const userId = session.user.id;

  const [user, urls, claimedPersons] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    prisma.discoveredUrl.findMany({
      where: { userId, tournamentId: { not: null } },
      include: { tournament: true },
    }),
    prisma.person.findMany({
      where: { claimedByUserId: userId },
      select: { id: true, displayName: true, normalizedName: true },
    }),
  ]);

  const claimedPersonIds = new Set(claimedPersons.map((p) => p.id));
  const tournamentIds = Array.from(
    new Set(urls.map((u) => u.tournamentId).filter((id): id is bigint => id != null)),
  );
  const tournamentById = new Map<bigint, NonNullable<(typeof urls)[number]['tournament']>>();
  for (const u of urls) if (u.tournament) tournamentById.set(u.tournament.id, u.tournament);

  const claimedNormalizedNames = new Set(claimedPersons.map((p) => p.normalizedName));
  const myNameByTournament = new Map<bigint, string>();
  for (const u of [...urls].sort((a, b) => a.url.localeCompare(b.url))) {
    if (!u.tournamentId || myNameByTournament.has(u.tournamentId)) continue;
    const reg = (u.registrationName ?? '').trim();
    if (reg && claimedNormalizedNames.has(normalizePersonName(reg))) {
      myNameByTournament.set(u.tournamentId, reg);
    }
  }

  const participations = tournamentIds.length
    ? await prisma.tournamentParticipant.findMany({
        where: { tournamentId: { in: tournamentIds }, person: { claimedByUserId: userId } },
        include: {
          roles: true,
          speakerRoundScores: {
            select: { roundNumber: true, positionLabel: true, score: true },
          },
        },
      })
    : [];

  const teamPairs = participations
    .filter((p) => p.teamName)
    .map((p) => ({ tournamentId: p.tournamentId, teamName: p.teamName! }));
  const teamPairKeys = new Set(teamPairs.map((p) => `${p.tournamentId}:${p.teamName}`));

  const [teammateRows, teamResultRows, judgeAssignmentRows, adjudicatorBreakRows] = await Promise.all([
    teamPairs.length
      ? prisma.tournamentParticipant.findMany({
          where: {
            OR: teamPairs.map((p) => ({ tournamentId: p.tournamentId, teamName: p.teamName })),
            roles: { some: { role: 'speaker' } },
          },
          select: {
            tournamentId: true,
            teamName: true,
            personId: true,
            person: { select: { displayName: true } },
          },
        })
      : Promise.resolve([]),
    tournamentIds.length
      ? prisma.teamResult.findMany({
          where: {
            tournamentId: { in: tournamentIds },
            roundNumber: 0,
          },
          select: { tournamentId: true, teamName: true, rank: true, wins: true, points: true },
        })
      : Promise.resolve([]),
    participations.length
      ? prisma.judgeAssignment.findMany({
          where: { tournamentId: { in: tournamentIds }, personId: { in: Array.from(claimedPersonIds) } },
          select: { tournamentId: true, personId: true, stage: true, roundNumber: true },
        })
      : Promise.resolve([]),
    tournamentIds.length
      ? prisma.eliminationResult.findMany({
          where: { tournamentId: { in: tournamentIds }, entityType: 'adjudicator' },
          select: { tournamentId: true, entityName: true },
        })
      : Promise.resolve([]),
  ]);

  const teammatesByKey = new Map<string, string[]>();
  for (const tm of teammateRows) {
    if (!tm.teamName) continue;
    const key = `${tm.tournamentId}:${tm.teamName}`;
    if (!teamPairKeys.has(key) || claimedPersonIds.has(tm.personId)) continue;
    const list = teammatesByKey.get(key) ?? [];
    list.push(tm.person.displayName);
    teammatesByKey.set(key, list);
  }

  const teamResultByKey = new Map<string, (typeof teamResultRows)[number]>();
  for (const tr of teamResultRows) {
    if (tr.teamName && teamPairKeys.has(teamResultKey(tr.tournamentId, tr.teamName))) {
      teamResultByKey.set(teamResultKey(tr.tournamentId, tr.teamName), tr);
    }
  }
  const teamRankByKey = buildTeamRankLookup(teamResultRows);

  const judgeBreakTournaments = new Set<bigint>();
  const myNormalizedNames = new Set(claimedPersons.map((p) => p.normalizedName));
  for (const row of adjudicatorBreakRows) {
    if (myNormalizedNames.has(normalizePersonName(row.entityName))) {
      judgeBreakTournaments.add(row.tournamentId);
    }
  }

  const judgeInroundsByTournament = new Map<bigint, Set<string>>();
  for (const a of judgeAssignmentRows) {
    if (!claimedPersonIds.has(a.personId)) continue;
    if (classifyRoundLabel(a.stage) !== 'inround') continue;
    const set = judgeInroundsByTournament.get(a.tournamentId) ?? new Set<string>();
    set.add(`${a.stage ?? ''}:${a.roundNumber ?? ''}`);
    judgeInroundsByTournament.set(a.tournamentId, set);
  }

  const myDisplayName = claimedPersons[0]?.displayName ?? user?.name ?? 'You';
  const speakerGroups = new Map<bigint, typeof participations>();
  for (const p of participations) {
    if (!p.roles.some((r) => r.role === 'speaker')) continue;
    const group = speakerGroups.get(p.tournamentId) ?? [];
    group.push(p);
    speakerGroups.set(p.tournamentId, group);
  }

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

  for (const [tournamentId, group] of speakerGroups) {
    const p =
      group
        .slice()
        .sort((a, b) =>
          (b.speakerScoreTotal ? 4 : 0) + (b.teamName ? 2 : 0) -
          ((a.speakerScoreTotal ? 4 : 0) + (a.teamName ? 2 : 0)),
        )[0] ?? group[0];
    if (!p) continue;
    const t = tournamentById.get(tournamentId);
    if (!t) continue;
    const key = p.teamName ? teamResultKey(tournamentId, p.teamName) : null;
    const teamResult = key ? teamResultByKey.get(key) : null;
    const avg = speakerAverage(p);
    const signals = mergeSpeakerCvSignals(group);
    const speakerRanks = [
      p.speakerRankOpen != null ? `#${p.speakerRankOpen} Open` : null,
      p.speakerRankEsl != null ? `#${p.speakerRankEsl} ESL` : null,
      p.speakerRankEfl != null ? `#${p.speakerRankEfl} EFL` : null,
    ].filter(Boolean).join(' | ');

    lines.push(csvLine([
      'speaker',
      t.name,
      t.year,
      t.format,
      t.totalTeams,
      myNameByTournament.get(tournamentId) ?? myDisplayName,
      key ? (teammatesByKey.get(key) ?? []).join(' | ') : '',
      p.teamName,
      key && teamRankByKey.has(key) ? `#${teamRankByKey.get(key)}` : '',
      teamResult?.points?.toString() ?? (teamResult?.wins != null ? `${teamResult.wins}W` : ''),
      avg.average,
      avg.prelims || '',
      speakerRanks,
      signals.broke ? 'Yes' : 'No',
      signals.eliminationReached,
      '',
      '',
      '',
      '',
      '',
    ]));
  }

  const judgeCandidates = participations.filter((p) =>
    p.roles.some((r) => r.role === 'judge') ||
    !!p.judgeTypeTag ||
    (p.chairedPrelimRounds ?? 0) > 0 ||
    !!p.lastOutroundChaired ||
    !!p.lastOutroundPaneled,
  );
  const judgeByTournament = new Map<bigint, (typeof judgeCandidates)[number]>();
  for (const p of judgeCandidates) {
    const existing = judgeByTournament.get(p.tournamentId);
    const score = (q: typeof p | undefined) =>
      !q ? -1 : (q.judgeTypeTag ? 1 : 0) + (q.chairedPrelimRounds ?? 0) + (q.lastOutroundChaired ? 5 : 0) + (q.lastOutroundPaneled ? 3 : 0);
    if (!existing || score(p) > score(existing)) judgeByTournament.set(p.tournamentId, p);
  }

  for (const [tournamentId, p] of judgeByTournament) {
    const t = tournamentById.get(tournamentId);
    if (!t) continue;
    const lastOutroundJudged = deepestOutroundAcrossRoles(p.lastOutroundChaired, p.lastOutroundPaneled);
    lines.push(csvLine([
      'judge',
      t.name,
      t.year,
      t.format,
      t.totalTeams,
      myNameByTournament.get(tournamentId) ?? myDisplayName,
      '',
      '',
      '',
      '',
      '',
      '',
      '',
      lastOutroundJudged || judgeBreakTournaments.has(tournamentId) ? 'Yes' : 'No',
      '',
      p.judgeTypeTag,
      judgeInroundsByTournament.get(tournamentId)?.size ?? '',
      p.chairedPrelimRounds ?? '',
      p.lastOutroundChaired,
      lastOutroundJudged,
    ]));
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
