import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { PieceKind } from '@/lib/calicotab/scrapePieces';
import type { AuditInputs, AuditPiece } from './auditInputs';

/**
 * Reads what the data-accuracy checks need for a batch of tournaments.
 *
 * The cron audits up to 50 tournaments a tick inside a shared time budget, so
 * the cost has to be flat in the batch size: every table is read with one
 * bulk or grouped query for the whole batch (`tournamentId in [...]`), never
 * one per tournament or per round, and the rows are split up in memory.
 * Grouped counts stand in for rows wherever a count is all a check reads: a
 * major has ~800 participants and thousands of judge rows, and none of them
 * need to leave Postgres. TeamResult is the one table read as rows (a
 * WUDC-scale tab is ~470 of them), with only the columns the checks use.
 *
 * Two tables take more than one grouped query, still per batch: participants
 * (a role lives on the joined ParticipantRole table, so speakers by team,
 * judges by tournament and scored speakers cannot share one grouping) and
 * judge assignments (panel counts per round, then distinct judges). The
 * team-tab redacted counts are one raw query per batch (redactedRows).
 */

export type LoadedAudit = AuditInputs & { usersAffected: number };

const ROUND_RESULTS = { source: 'round_results', roundNumber: { not: null } } as const;

/** Prisma Decimal (or a plain number from a test) to a number. */
function num(v: { toNumber(): number } | number | null): number | null {
  if (v == null) return null;
  return typeof v === 'number' ? v : v.toNumber();
}

function empty(t: {
  format: string | null;
  prelimRoundCount: number | null;
  parserVersion: string | null;
}): LoadedAudit {
  return {
    format: t.format,
    prelimRoundCount: t.prelimRoundCount,
    parserVersion: t.parserVersion,
    teamTab: [],
    roundRows: [],
    outrounds: [],
    breakRows: [],
    speakersByTeam: {},
    redactedByTeam: {},
    speakerParticipants: 0,
    speakersWithScores: 0,
    judgeParticipants: 0,
    roundResultJudges: 0,
    judgesByRound: {},
    motionRounds: [],
    pieces: [],
    openReports: [],
    usersAffected: 0,
  };
}

/** The tournament, team-result and outround rows. */
function queryRows(ids: bigint[]) {
  const tournamentId = { in: ids };
  return Promise.all([
    prisma.tournament.findMany({
      where: { id: tournamentId },
      select: { id: true, format: true, prelimRoundCount: true, parserVersion: true },
    }),
    // Round 0 is the team tab; rounds ≥ 1 are prelims. Null rounds (none are
    // written today) would be neither, so they are left in the database.
    prisma.teamResult.findMany({
      where: { tournamentId, roundNumber: { not: null } },
      select: {
        tournamentId: true,
        teamName: true,
        roundNumber: true,
        points: true,
        wins: true,
        position: true,
      },
    }),
    // Outcomes plus the break tabs' rows; anything else in `result` (the
    // legacy 'rank:N' strings were nulled, but readers still filter) is out.
    prisma.eliminationResult.findMany({
      where: {
        tournamentId,
        entityType: 'team',
        OR: [{ result: { in: ['won', 'lost'] } }, { result: null }],
      },
      select: { tournamentId: true, stage: true, entityName: true, result: true },
    }),
  ]);
}

/** The grouped counts (participants, judges, motions, users), pieces and reports. */
function queryCounts(ids: bigint[]) {
  const tournamentId = { in: ids };
  return Promise.all([
    prisma.tournamentParticipant.groupBy({
      by: ['tournamentId', 'teamName'],
      where: { tournamentId, roles: { some: { role: 'speaker' } } },
      _count: { _all: true },
    }),
    prisma.tournamentParticipant.groupBy({
      by: ['tournamentId'],
      where: { tournamentId, roles: { some: { role: 'judge' } } },
      _count: { _all: true },
    }),
    prisma.judgeAssignment.groupBy({
      by: ['tournamentId', 'roundNumber', 'panelRole'],
      where: { tournamentId, ...ROUND_RESULTS },
      _count: { _all: true },
    }),
    prisma.judgeAssignment.groupBy({
      by: ['tournamentId', 'personId'],
      where: { tournamentId, ...ROUND_RESULTS },
    }),
    prisma.motion.groupBy({
      by: ['tournamentId', 'roundNumber'],
      where: { tournamentId, roundNumber: { not: null } },
    }),
    prisma.scrapePiece.findMany({
      where: { tournamentId },
      select: {
        tournamentId: true,
        kind: true,
        key: true,
        label: true,
        status: true,
        reason: true,
        url: true,
      },
    }),
    // A report names tournaments by id as strings (CvErrorReport.tournamentIds).
    prisma.cvErrorReport.findMany({
      where: {
        status: { in: ['open', 'acknowledged'] },
        tournamentIds: { hasSome: ids.map(String) },
      },
      select: { tournamentIds: true, categories: true },
    }),
    // One group per (tournament, user): the users with this tournament on a CV.
    prisma.discoveredUrl.groupBy({
      by: ['tournamentId', 'userId'],
      where: { tournamentId },
    }),
  ]);
}

/**
 * Speakers with a score: a tab total, or any per-round score. Many Asian and
 * Australs tabs publish R1..Rn and an average with no total column, so
 * speakerScoreTotal stays null for every speaker while every score is stored
 * as SpeakerRoundScore rows; counting totals alone failed such a tab.
 */
function queryScored(ids: bigint[]) {
  return prisma.tournamentParticipant.groupBy({
    by: ['tournamentId'],
    where: {
      tournamentId: { in: ids },
      roles: { some: { role: 'speaker' } },
      OR: [{ speakerScoreTotal: { not: null } }, { speakerRoundScores: { some: {} } }],
    },
    _count: { _all: true },
  });
}

type RedactedRow = { tournamentId: bigint; teamName: string; redactedSpeakers: number | null };

/**
 * The team tab's redacted-speaker counts (TeamResult.redactedSpeakers, round
 * 0). Raw SQL rather than the generated client, so the audit does not depend
 * on a client generated after the column was added.
 */
function redactedRows(ids: bigint[]) {
  return prisma.$queryRaw<RedactedRow[]>`
    SELECT "tournamentId", "teamName", "redactedSpeakers" FROM "TeamResult"
    WHERE "tournamentId" IN (${Prisma.join(ids)}) AND "roundNumber" = 0`;
}

async function queryBatch(ids: bigint[]) {
  const [rows, counts, scored, redacted] = await Promise.all([
    queryRows(ids),
    queryCounts(ids),
    queryScored(ids),
    redactedRows(ids),
  ]);
  return { all: [...rows, ...counts] as const, scored, redacted };
}

type BatchRows = Awaited<ReturnType<typeof queryBatch>>['all'];
type Extra = Omit<Awaited<ReturnType<typeof queryBatch>>, 'all'>;

function addTeamRows(out: Map<bigint, LoadedAudit>, rows: BatchRows[1]) {
  for (const r of rows) {
    const a = out.get(r.tournamentId);
    if (!a || r.roundNumber == null) continue;
    const points = num(r.points);
    if (r.roundNumber === 0) a.teamTab.push({ team: r.teamName, points, wins: r.wins });
    else if (r.roundNumber > 0) {
      a.roundRows.push({
        team: r.teamName,
        round: r.roundNumber,
        points,
        wins: r.wins,
        position: r.position,
      });
    }
  }
}

function addOutroundRows(out: Map<bigint, LoadedAudit>, rows: BatchRows[2]) {
  for (const r of rows) {
    const a = out.get(r.tournamentId);
    if (!a) continue;
    if (r.result === 'won' || r.result === 'lost') {
      a.outrounds.push({ stage: r.stage, team: r.entityName, result: r.result });
    } else if (r.result == null) {
      a.breakRows.push({ stage: r.stage, team: r.entityName });
    }
  }
}

function addParticipants(
  out: Map<bigint, LoadedAudit>,
  speakers: BatchRows[3],
  judges: BatchRows[4],
) {
  for (const g of speakers) {
    const a = out.get(g.tournamentId);
    if (!a) continue;
    a.speakerParticipants += g._count._all;
    // Raw names: the checks normalise keys themselves (teamKey).
    if (g.teamName != null) a.speakersByTeam[g.teamName] = g._count._all;
  }
  for (const g of judges) {
    const a = out.get(g.tournamentId);
    if (a) a.judgeParticipants = g._count._all;
  }
}

function addJudges(out: Map<bigint, LoadedAudit>, panels: BatchRows[5], people: BatchRows[6]) {
  for (const g of panels) {
    const a = out.get(g.tournamentId);
    if (!a || g.roundNumber == null) continue;
    const round = (a.judgesByRound[g.roundNumber] ??= { chairs: 0, judges: 0 });
    // Trainees sit on the panel too, so `judges` counts every role.
    round.judges += g._count._all;
    if (g.panelRole === 'chair') round.chairs += g._count._all;
  }
  for (const g of people) {
    const a = out.get(g.tournamentId);
    if (a) a.roundResultJudges += 1;
  }
}

function addRest(out: Map<bigint, LoadedAudit>, rows: BatchRows) {
  const [, , , , , , , motions, pieces, reports, users] = rows;
  for (const m of motions) {
    if (m.roundNumber != null) out.get(m.tournamentId)?.motionRounds.push(m.roundNumber);
  }
  for (const a of out.values()) a.motionRounds.sort((x, y) => x - y);
  for (const p of pieces) {
    out.get(p.tournamentId)?.pieces.push({
      kind: p.kind as PieceKind,
      key: p.key,
      label: p.label,
      status: p.status as AuditPiece['status'],
      reason: p.reason,
      url: p.url,
    });
  }
  for (const r of reports) {
    for (const id of r.tournamentIds) {
      if (!/^\d{1,18}$/.test(id)) continue;
      out.get(BigInt(id))?.openReports.push({ categories: r.categories });
    }
  }
  for (const u of users) {
    if (u.tournamentId == null) continue;
    const a = out.get(u.tournamentId);
    if (a) a.usersAffected += 1;
  }
}

function addExtra(out: Map<bigint, LoadedAudit>, { scored, redacted }: Extra) {
  for (const g of scored) {
    const a = out.get(g.tournamentId);
    if (a) a.speakersWithScores = g._count._all;
  }
  for (const r of redacted) {
    const a = out.get(r.tournamentId);
    if (a) a.redactedByTeam[r.teamName] = r.redactedSpeakers;
  }
}

/**
 * AuditInputs (plus usersAffected) for each id that has a Tournament row; ids
 * without one are left out of the map.
 */
export async function loadAuditInputs(tournamentIds: bigint[]): Promise<Map<bigint, LoadedAudit>> {
  const out = new Map<bigint, LoadedAudit>();
  if (tournamentIds.length === 0) return out;
  const batch = await queryBatch(tournamentIds);
  const rows = batch.all;
  for (const t of rows[0]) out.set(t.id, empty(t));
  addTeamRows(out, rows[1]);
  addOutroundRows(out, rows[2]);
  addParticipants(out, rows[3], rows[4]);
  addJudges(out, rows[5], rows[6]);
  addRest(out, rows);
  addExtra(out, batch);
  return out;
}
