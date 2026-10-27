/**
 * Server-side loader for the Found tab. Reads only data that is already in
 * the database (pre-scraped and ingested public tabs); it never fetches a
 * tab and never writes.
 *
 * Exact matching only (owner's decision, 2026-10-27). The names searched are
 * the user's CLAIMED names (`Person.claimedByUserId = user`), each by its
 * whole stored key (a one-word name matches only that one word). Query plan:
 *
 *  1. The user's claimed names: `Person(claimedByUserId)` index.
 *  2. The user's own private-URL tournaments and the teammates on their
 *     teams there (teammate evidence only): `DiscoveredUrl(userId, ...)`,
 *     `TournamentParticipant(tournamentId)`.
 *  3. ONE joined query (lib/discovery/candidates.ts): Person by key equality
 *     on the unique `normalizedName` btree, their appearances, every
 *     exclusion, capped per name.
 *  4. Round facts at the candidate tournaments, by exact pairs, chunked
 *     (lib/discovery/roundFacts.ts).
 *  5. The user's decisions: `AppearanceCandidate(userId, status)`.
 *
 * Each stage is timed and logged as one structured line, and the caller can
 * stop the run between stages with an AbortSignal (lib/discovery/budget.ts).
 */

import { prisma } from '@/lib/db';
import { displayNameFor } from '@/lib/privacy/suppression';
import { publicTournamentUrl } from '@/lib/cv/publicTournamentUrl';
import { isEudcTournament } from '@/lib/calicotab/breakCategoryResolve';
import { isStandInName, selectAliases, type Alias } from '@/lib/discovery/names';
import { ALIAS_CAP, findCandidates, type CandidateRow } from '@/lib/discovery/candidates';
import { loadRoundFacts, NO_ROUND_FACTS, type RoundFacts } from '@/lib/discovery/roundFacts';
import {
  appearanceKey,
  buildRows,
  type Appearance,
  type Decision,
  type FoundRow,
} from '@/lib/discovery/match';
import type { CappedAlias, FoundInput, StoredDecision } from '@/lib/discovery/view';

export { ALIAS_CAP };

type Teammate = { name: string; where: string };

function placeLabel(name: string, year: number | null): string {
  return year != null && !name.includes(String(year)) ? `${name} ${year}` : name;
}

/** The user's claimed names: the only names the Found tab searches. */
async function loadClaimedNames(userId: string): Promise<string[]> {
  const persons = await prisma.person.findMany({
    where: { claimedByUserId: userId, suppressedAt: null },
    select: { displayName: true },
  });
  return persons.map((p) => p.displayName);
}

/**
 * The user's teammates on their own private-URL tournaments, by Person id,
 * with where they were on one team: teammate evidence for a candidate row.
 */
async function loadTeammates(userId: string): Promise<Map<string, Teammate>> {
  const urls = await prisma.discoveredUrl.findMany({
    where: { userId, tournamentId: { not: null }, ingestedAt: { not: null } },
    select: { tournamentId: true },
  });
  const ingestedIds = [...new Set(urls.map((u) => u.tournamentId as bigint))];
  const own = ingestedIds.length
    ? await prisma.tournamentParticipant.findMany({
        where: { tournamentId: { in: ingestedIds }, person: { claimedByUserId: userId } },
        select: {
          tournamentId: true,
          personId: true,
          teamName: true,
          tournament: { select: { name: true, year: true } },
        },
      })
    : [];
  const teams = own.filter((o) => o.teamName);
  const mates = teams.length
    ? await prisma.tournamentParticipant.findMany({
        where: {
          OR: teams.map((o) => ({ tournamentId: o.tournamentId, teamName: o.teamName })),
          personId: { notIn: own.map((o) => o.personId) },
        },
        select: {
          tournamentId: true,
          personId: true,
          person: { select: { displayName: true, suppressedAt: true } },
        },
      })
    : [];
  const placeById = new Map(
    own.map((o) => [String(o.tournamentId), placeLabel(o.tournament.name, o.tournament.year)]),
  );
  const teammates = new Map<string, Teammate>();
  for (const m of mates) {
    if (isStandInName(m.person.displayName) || teammates.has(String(m.personId))) continue;
    teammates.set(String(m.personId), {
      name: displayNameFor(m.person),
      where: placeById.get(String(m.tournamentId)) ?? '',
    });
  }
  return teammates;
}

function evidenceList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

async function loadStoredDecisions(userId: string): Promise<StoredDecision[]> {
  const rows = await prisma.appearanceCandidate.findMany({
    where: { userId, status: { in: ['confirmed', 'rejected'] } },
    select: {
      tournamentId: true,
      personId: true,
      status: true,
      evidence: true,
      tournament: { select: { name: true, year: true, sourceUrlRaw: true } },
      person: { select: { displayName: true, suppressedAt: true } },
    },
    orderBy: { decidedAt: 'desc' },
    take: 500,
  });
  return rows.map((r) => ({
    tournamentId: String(r.tournamentId),
    personId: String(r.personId),
    tournamentName: r.tournament.name,
    year: r.tournament.year,
    publicUrl: publicTournamentUrl(r.tournament.sourceUrlRaw),
    listedName: displayNameFor(r.person),
    status: r.status as Decision,
    evidence: evidenceList(r.evidence),
  }));
}

function toAppearance(
  c: CandidateRow,
  ctx: {
    userId: string;
    aliases: readonly Alias[];
    rounds: RoundFacts;
    teammates: Map<string, Teammate>;
  },
): Appearance {
  const t = String(c.tournamentId);
  const p = String(c.personId);
  const slots = [
    ...(c.teamName ? (ctx.rounds.teamSlots.get(`${t}:${c.teamName}`) ?? []) : []),
    ...(ctx.rounds.judgeSlots.get(`${t}:${p}`) ?? []),
  ];
  const teammates = (ctx.rounds.sightings.get(t) ?? [])
    .filter((s) => s.personId !== p)
    .flatMap((s) => {
      const mate = ctx.teammates.get(s.personId);
      if (!mate) return [];
      return [{ ...mate, sameTeam: c.teamName != null && s.teamName === c.teamName }];
    });
  return {
    tournamentId: t,
    personId: p,
    tournamentName: c.tournamentName,
    year: c.year,
    region: c.region,
    publicUrl: publicTournamentUrl(c.sourceUrlRaw),
    listedName: c.displayName,
    alias: ctx.aliases[c.alias]?.name ?? c.displayName,
    matchKind: c.matchKind,
    roles: c.roles,
    teamName: c.teamName,
    mine: c.claimedByUserId === ctx.userId,
    slots,
    eudc: isEudcTournament(c.tournamentName),
    teammates: teammates.sort((a, b) => Number(b.sameTeam) - Number(a.sameTeam)),
  };
}

/** Names whose matches hit ALIAS_CAP: the page says "showing the first N". */
function cappedAliases(rows: readonly CandidateRow[], aliases: readonly Alias[]): CappedAlias[] {
  const out = new Map<number, CappedAlias>();
  for (const r of rows) {
    if (r.aliasTotal > ALIAS_CAP && !out.has(r.alias)) {
      out.set(r.alias, {
        name: aliases[r.alias]?.name ?? '',
        total: r.aliasTotal,
        shown: ALIAS_CAP,
      });
    }
  }
  return [...out.values()];
}

/** Stage names and their ms, plus row counts, for the one log line. */
function stageTimer() {
  const started = Date.now();
  let last = started;
  const stages: Record<string, number> = {};
  const counts: Record<string, number> = {};
  return {
    mark(stage: string, count?: Record<string, number>) {
      const now = Date.now();
      stages[stage] = now - last;
      last = now;
      if (count) Object.assign(counts, count);
    },
    report: () => ({ totalMs: Date.now() - started, stages, counts }),
  };
}

/** Thrown between stages once the caller's time budget has run out. */
export class FoundAbortedError extends Error {
  constructor() {
    super('found: load aborted (time budget)');
    this.name = 'FoundAbortedError';
  }
}

function checkAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new FoundAbortedError();
}

export type FoundLoad = { input: FoundInput; rows: FoundRow[] };

/**
 * Everything /cv/found shows, and what the decision route validates against.
 */
export async function loadFound(
  userId: string,
  opts: { signal?: AbortSignal } = {},
): Promise<FoundLoad> {
  const timer = stageTimer();
  try {
    return await runLoad(userId, timer, opts.signal);
  } finally {
    // One structured line per run, so the Vercel log shows where time went
    // (and how far a run got before a timeout or an error).
    console.info(`[found] timing ${JSON.stringify(timer.report())}`);
  }
}

async function runLoad(
  userId: string,
  timer: ReturnType<typeof stageTimer>,
  signal: AbortSignal | undefined,
): Promise<FoundLoad> {
  const [names, stored] = await Promise.all([
    loadClaimedNames(userId),
    loadStoredDecisions(userId),
  ]);
  const selection = selectAliases(names);
  timer.mark('names', {
    claimedNames: names.length,
    aliases: selection.aliases.length,
    stored: stored.length,
  });
  checkAborted(signal);
  const base = {
    aliasCount: selection.aliases.length,
    unsearchable: selection.unsearchable,
    overLimit: selection.overLimit,
  };
  const decisions = new Map<string, Decision>(
    stored.map((d) => [appearanceKey(d.tournamentId, d.personId), d.status]),
  );
  if (selection.aliases.length === 0) {
    return { input: { ...base, capped: [], rows: [], stored }, rows: [] };
  }

  const cands = await findCandidates(userId, selection.aliases);
  timer.mark('candidates', { candidates: cands.length });
  checkAborted(signal);

  const teammates = cands.length ? await loadTeammates(userId) : new Map<string, Teammate>();
  timer.mark('teammates', { teammates: teammates.size });
  checkAborted(signal);

  const rounds = cands.length ? await loadRoundFacts(cands, [...teammates.keys()]) : NO_ROUND_FACTS;
  timer.mark('roundFacts');
  checkAborted(signal);

  const apps = cands.map((c) =>
    toAppearance(c, { userId, aliases: selection.aliases, rounds, teammates }),
  );
  const rows = buildRows(apps, decisions);
  timer.mark('rows', { rows: rows.length });
  return {
    input: { ...base, capped: cappedAliases(cands, selection.aliases), rows, stored },
    rows,
  };
}
