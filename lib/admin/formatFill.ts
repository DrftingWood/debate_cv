import { prisma } from '@/lib/db';
import { runAudit } from '@/lib/audit/run';
import { decideTournamentFormat, type FormatInput } from '@/lib/calicotab/format';
import { FILL_BATCH_SIZE } from '@/lib/admin/formatFillText';

/**
 * Filling a missing Tournament.format from what is already stored, with no
 * fetch. Ingest decides the format while the pages are in hand
 * (inferTournamentFormat, from team sizes and each round's seats); a
 * tournament stored without one can have it re-derived from the same
 * signals as they sit in the database: the seats of every prelim result row
 * and how many speakers each team has. One function builds that input and
 * one decides, and both "Infer format" (a single tournament) and "Fill
 * missing formats" (a bounded batch) go through them.
 *
 * Not everything ingest saw is stored: the registration block and the raw
 * team tab's speaker lists are not, so a tournament whose format rested only
 * on those stays undecided here and the admin is pointed at a re-scrape.
 */

/** Tournaments one press of "Fill missing formats" goes over, oldest id first. */
export const FILL_BATCH = FILL_BATCH_SIZE;
/** Re-audit chunk size, run.ts's sweep size. */
const AUDIT_CHUNK = 25;

type Seats = Array<{ position: string | null }>;

/**
 * The rules of decideTournamentFormat that stored data may decide on (ruling
 * 15; and ruling 14: a wrong format is worse than a null one):
 *   1  four-team (BP) room shape, read from the stored seats alone;
 *   2  a format the tournament's own name states;
 *   4  a well-known BP championship name.
 * Rule 3 (a two-team room shape confirmed by the squad size) and rule 5 (the
 * team size alone) both depend on squad counts, and the only squads stored
 * are the speakers a partial import happened to keep: a 3-a-side Gov/Opp
 * event stored with two speakers a team reads as Two-team Parliamentary, and
 * a null-seat event reads BP or Asian from its size alone. Both stay
 * undecided here, at the cost of leaving clean two-team events for a
 * re-scrape too; the admin is told to re-scrape R1 and the team tab.
 */
const STORED_RULES: ReadonlySet<number> = new Set([1, 2, 4]);

function decideFromStored(input: FormatInput): string | null {
  const { format, rule } = decideTournamentFormat(input);
  return rule != null && STORED_RULES.has(rule) ? format : null;
}

/**
 * The inference input of each tournament, read with one query per table for
 * the whole batch. Squad sizes come from the stored speakers grouped by team
 * name, which stand in for the team tab's speaker lists; the rounds are the
 * prelim result rows (roundNumber ≥ 1) grouped by round for their seats.
 */
async function loadInputs(ids: bigint[]) {
  const tournamentId = { in: ids };
  const [tournaments, results, squads] = await Promise.all([
    prisma.tournament.findMany({
      where: { id: tournamentId },
      select: { id: true, name: true, format: true },
    }),
    // TeamResult holds prelim rounds only (ingest writes outrounds to
    // EliminationResult), so `rounds` here is the prelims, which is what the
    // room-shape rules read.
    prisma.teamResult.findMany({
      where: { tournamentId, roundNumber: { gte: 1 } },
      select: { tournamentId: true, roundNumber: true, position: true },
    }),
    prisma.tournamentParticipant.groupBy({
      by: ['tournamentId', 'teamName'],
      where: { tournamentId, roles: { some: { role: 'speaker' } } },
      _count: { _all: true },
    }),
  ]);

  const byId = new Map<string, { format: string | null; input: FormatInput }>();
  for (const t of tournaments) {
    byId.set(String(t.id), {
      format: t.format,
      input: {
        tournamentName: t.name,
        teamRows: [],
        speakerRows: [],
        participantRows: [],
        registrationSpeakers: [],
        rounds: [],
      },
    });
  }
  // Seats grouped by round, so each round is one entry of `rounds`.
  const roundSeats = new Map<string, Map<number, Seats>>();
  for (const r of results) {
    if (r.roundNumber == null) continue;
    const key = String(r.tournamentId);
    const rounds = roundSeats.get(key) ?? new Map<number, Seats>();
    const seats = rounds.get(r.roundNumber) ?? [];
    seats.push({ position: r.position });
    rounds.set(r.roundNumber, seats);
    roundSeats.set(key, rounds);
  }
  for (const [key, rounds] of roundSeats) {
    const entry = byId.get(key);
    if (entry) entry.input.rounds = [...rounds.values()].map((teamResults) => ({ teamResults }));
  }
  for (const g of squads) {
    if (g.teamName == null) continue;
    const entry = byId.get(String(g.tournamentId));
    // Squad evidence goes in as participant rows, the lowest-priority source
    // the inference has (the team tab and speaker-tab groupings outrank it).
    // It is all the database keeps: the team tab's speaker lists are not
    // stored, and feeding counts in as `teamRows` would present them as the
    // tab itself and let them outvote better evidence. One row per speaker is
    // enough, the inference only counts them per team.
    for (let i = 0; i < g._count._all; i++) {
      entry?.input.participantRows?.push({ role: 'speaker', teamName: g.teamName });
    }
  }
  return byId;
}

/** The format of each tournament as the stored data decides it, or null when it cannot. */
export async function inferStoredFormats(ids: bigint[]): Promise<Map<string, string | null>> {
  const loaded = await loadInputs(ids);
  const out = new Map<string, string | null>();
  for (const [key, { input }] of loaded) out.set(key, decideFromStored(input));
  return out;
}

export type FillOutcome = {
  /** Written and re-audited. */
  filled: Array<{ id: bigint; format: string }>;
  /** The stored data could not decide: re-scrape R1 and the team tab. */
  undecided: bigint[];
  /** Already had a format (set by a scrape since the admin looked): untouched. */
  already?: bigint[];
};

/**
 * Infers and stores the format of each tournament that still has none, then
 * re-audits the ones filled so their score moves at once. The write is
 * guarded (`format: null`) so a scrape that landed meanwhile is not
 * overwritten; a row it lost to is not counted as filled.
 */
export async function fillFormats(ids: bigint[]): Promise<FillOutcome> {
  const loaded = await loadInputs(ids);
  const filled: FillOutcome['filled'] = [];
  const undecided: bigint[] = [];
  const already: bigint[] = [];
  for (const id of ids) {
    const entry = loaded.get(String(id));
    if (!entry) continue;
    if (entry.format) {
      already.push(id);
      continue;
    }
    const format = decideFromStored(entry.input);
    if (!format) {
      undecided.push(id);
      continue;
    }
    const { count } = await prisma.tournament.updateMany({
      where: { id, format: null },
      data: { format },
    });
    if (count > 0) filled.push({ id, format });
    else already.push(id);
  }
  const audited = filled.map((f) => f.id);
  for (let i = 0; i < audited.length; i += AUDIT_CHUNK) {
    await runAudit(audited.slice(i, i + AUDIT_CHUNK));
  }
  return already.length > 0 ? { filled, undecided, already } : { filled, undecided };
}

export type BatchOutcome = {
  filled: number;
  undecided: number;
  /** Tournaments with no format past this batch's last id. */
  left: number;
  /** Where the next press continues; null when nothing is left. */
  next: string | null;
};

/**
 * One bounded press of "Fill missing formats": the next FILL_BATCH
 * tournaments with no format after `after`, by id. A tournament the data
 * cannot decide stays null, so a press that always started from the top
 * would meet it again forever; the cursor moves past it instead.
 */
export async function fillMissingBatch(after: bigint | null): Promise<BatchOutcome> {
  const missing = { format: null, ...(after != null ? { id: { gt: after } } : {}) };
  const batch = await prisma.tournament.findMany({
    where: missing,
    orderBy: { id: 'asc' },
    take: FILL_BATCH,
    select: { id: true },
  });
  const last = batch.at(-1);
  if (!last) return { filled: 0, undecided: 0, left: 0, next: null };
  const outcome = await fillFormats(batch.map((b) => b.id));
  const left = await prisma.tournament.count({ where: { format: null, id: { gt: last.id } } });
  return {
    filled: outcome.filled.length,
    undecided: outcome.undecided.length,
    left,
    next: left > 0 ? String(last.id) : null,
  };
}
