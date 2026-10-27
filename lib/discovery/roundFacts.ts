/**
 * Round slots and teammate sightings at the Found tab's candidate
 * tournaments: what the same-round warnings and the teammate evidence need.
 *
 * Every read is keyed by the exact (tournament, team) or (tournament,
 * person) pairs the candidates hold, never `tournamentId IN (...) AND
 * teamName IN (...)`. That cross product was the first loader's shape: on a
 * btree whose first two columns both carry an IN list, Postgres 16 can
 * descend the index once per COMBINATION of the two lists (1000 tournaments
 * x 1500 team names took 5.8 s on a local copy at production volume when
 * the planner chose that path), and most rows it returned belonged to other
 * teams that happened to share a name. Pairs cost one descent each, in
 * chunks, a few at a time, so the pooled connection is never flooded.
 */

import { prisma } from '@/lib/db';
import { judgeSlot, speakSlot, type Slot } from '@/lib/discovery/rounds';

type Cand = { tournamentId: bigint; personId: bigint; teamName: string | null };

/** Exact pairs per query. */
const PAIR_CHUNK = 200;
/** Concurrent queries; below the pool size `lib/db.ts` guarantees. */
const QUERY_CONCURRENCY = 3;

async function inBatches<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    out.push(...(await Promise.all(items.slice(i, i + limit).map(fn))));
  }
  return out;
}

function chunks<T>(list: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

function uniquePairs<K>(
  cands: readonly Cand[],
  key: (c: Cand) => K | null,
): { tournamentId: bigint; key: K }[] {
  const seen = new Map<string, { tournamentId: bigint; key: K }>();
  for (const c of cands) {
    const k = key(c);
    if (k != null) {
      seen.set(`${c.tournamentId}:${String(k)}`, { tournamentId: c.tournamentId, key: k });
    }
  }
  return [...seen.values()];
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

export type RoundFacts = {
  /** `${tournamentId}:${teamName}` → the team's speaking slots. */
  teamSlots: Map<string, Slot[]>;
  /** `${tournamentId}:${personId}` → the person's judging slots. */
  judgeSlots: Map<string, Slot[]>;
  /** tournamentId → the user's teammates seen there. */
  sightings: Map<string, { personId: string; teamName: string | null }[]>;
};

export const NO_ROUND_FACTS: RoundFacts = {
  teamSlots: new Map(),
  judgeSlots: new Map(),
  sightings: new Map(),
};

export async function loadRoundFacts(
  cands: readonly Cand[],
  teammateIds: readonly string[],
): Promise<RoundFacts> {
  const candTournaments = new Set(cands.map((c) => String(c.tournamentId)));
  const teamPairs = uniquePairs(cands, (c) => c.teamName);
  const judgePairs = uniquePairs(cands, (c) => c.personId);

  // A teammate's own participations (by the personId index), kept only where
  // a candidate is: a few hundred rows, not a cross product.
  const overlapsRaw = teammateIds.length
    ? await prisma.tournamentParticipant.findMany({
        where: { personId: { in: teammateIds.map(BigInt) } },
        select: { tournamentId: true, personId: true, teamName: true },
      })
    : [];
  const overlaps = overlapsRaw.filter((o) => candTournaments.has(String(o.tournamentId)));

  const teamRounds = (
    await inBatches(chunks(teamPairs, PAIR_CHUNK), QUERY_CONCURRENCY, (chunk) =>
      prisma.teamResult.findMany({
        where: {
          OR: chunk.map((p) => ({ tournamentId: p.tournamentId, teamName: p.key })),
          roundNumber: { gt: 0 },
        },
        select: { tournamentId: true, teamName: true, roundNumber: true },
      }),
    )
  ).flat();
  const outrounds = (
    await inBatches(chunks(teamPairs, PAIR_CHUNK), QUERY_CONCURRENCY, (chunk) =>
      prisma.eliminationResult.findMany({
        where: {
          entityType: 'team',
          OR: chunk.map((p) => ({ tournamentId: p.tournamentId, entityName: p.key })),
        },
        select: { tournamentId: true, entityName: true, stage: true },
      }),
    )
  ).flat();
  const judging = (
    await inBatches(chunks(judgePairs, PAIR_CHUNK), QUERY_CONCURRENCY, (chunk) =>
      prisma.judgeAssignment.findMany({
        where: { OR: chunk.map((p) => ({ tournamentId: p.tournamentId, personId: p.key })) },
        select: { tournamentId: true, personId: true, stage: true, roundNumber: true },
      }),
    )
  ).flat();

  const teamSlots = new Map<string, Slot[]>();
  for (const r of teamRounds) {
    const s = speakSlot(null, r.roundNumber, r.teamName);
    if (s) pushTo(teamSlots, `${r.tournamentId}:${r.teamName}`, s);
  }
  for (const r of outrounds) {
    const s = speakSlot(r.stage, null, r.entityName);
    if (s) pushTo(teamSlots, `${r.tournamentId}:${r.entityName}`, s);
  }
  const judgeSlots = new Map<string, Slot[]>();
  for (const j of judging) {
    const s = judgeSlot(j.stage, j.roundNumber);
    if (s) pushTo(judgeSlots, `${j.tournamentId}:${j.personId}`, s);
  }
  const sightings = new Map<string, { personId: string; teamName: string | null }[]>();
  for (const o of overlaps) {
    pushTo(sightings, String(o.tournamentId), {
      personId: String(o.personId),
      teamName: o.teamName,
    });
  }
  return { teamSlots, judgeSlots, sightings };
}
