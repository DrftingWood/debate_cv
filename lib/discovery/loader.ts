/**
 * Server-side loader for the Found tab. Reads only data that is already in
 * the database (pre-scraped and ingested public tabs); it never fetches a
 * tab and never writes.
 *
 * Query plan, in order, each one index-driven and bounded:
 *
 *  1. The user's DiscoveredUrl rows: `(userId, url)` unique, leading column.
 *  2. The user's own participations at their ingested tournaments, then the
 *     teammates on those teams: `TournamentParticipant(tournamentId)`, a few
 *     dozen tournaments at most.
 *  3. Name lookup on `Person.normalizedName` (unique btree): one `IN` of
 *     enumerated keys (about a thousand per anchor, at most five anchors) and
 *     at most four range scans per anchor, each capped at RANGE_CAP rows. No
 *     scan of the Person table.
 *  4. The surviving names' participations: `TournamentParticipant(personId)`,
 *     capped at PARTICIPATION_CAP.
 *  5. Evidence and round facts at the candidate tournaments only:
 *     `TournamentParticipant(tournamentId, personId)` unique,
 *     `TeamResult(tournamentId, teamName, roundNumber)` unique,
 *     `EliminationResult(tournamentId, ...)` unique, `JudgeAssignment(personId)`.
 *  6. The user's decisions: `AppearanceCandidate(userId, status)`.
 *
 * None of these is a per-request scan of a large table. The run is repeated
 * on each visit rather than cached: at phase 1's scale (owner and testers)
 * that is cheaper than a staleness protocol, and nothing is written.
 */

import { prisma } from '@/lib/db';
import { displayNameFor } from '@/lib/privacy/suppression';
import { publicTournamentUrl } from '@/lib/cv/publicTournamentUrl';
import { isEudcTournament } from '@/lib/calicotab/breakCategoryResolve';
import {
  bestMatch,
  isStandInName,
  lookupKeys,
  prefixRanges,
  selectAnchors,
  type PrefixRange,
} from '@/lib/discovery/names';
import { judgeSlot, speakSlot, type Slot } from '@/lib/discovery/rounds';
import {
  rankAppearances,
  appearanceKey,
  type Appearance,
  type Decision,
  type FoundRow,
} from '@/lib/discovery/match';
import type { FoundInput, StoredDecision } from '@/lib/discovery/view';

/** Rows read per name range; a common first name stops here. */
export const RANGE_CAP = 300;
/** Participations read for all candidate names together. */
export const PARTICIPATION_CAP = 1500;

type Teammate = { name: string; where: string };

type UserFacts = {
  /** Every tournament the user has a private URL for, ingested or not. */
  ownTournamentIds: Set<string>;
  registrationNames: string[];
  years: number[];
  regions: string[];
  /** The user's teammates on their own private-URL tournaments, by Person id. */
  teammates: Map<string, Teammate>;
};

function placeLabel(name: string, year: number | null): string {
  return year != null && !name.includes(String(year)) ? `${name} ${year}` : name;
}

async function loadUserFacts(userId: string): Promise<UserFacts> {
  const urls = await prisma.discoveredUrl.findMany({
    where: { userId, tournamentId: { not: null } },
    select: {
      tournamentId: true,
      ingestedAt: true,
      registrationName: true,
      registrationPerson: { select: { claimedByUserId: true } },
    },
  });
  const ownTournamentIds = new Set(urls.map((u) => String(u.tournamentId)));
  const ingested = urls.filter((u) => u.ingestedAt != null);
  // Anchors: the registration card's name, and only where the user holds
  // that name. Never the Google name, never a typed or onboarding-only name.
  const registrationNames = ingested
    .filter((u) => u.registrationName && u.registrationPerson?.claimedByUserId === userId)
    .map((u) => u.registrationName as string);
  const ingestedIds = [...new Set(ingested.map((u) => u.tournamentId as bigint))];

  const own = ingestedIds.length
    ? await prisma.tournamentParticipant.findMany({
        where: { tournamentId: { in: ingestedIds }, person: { claimedByUserId: userId } },
        select: {
          tournamentId: true,
          personId: true,
          teamName: true,
          tournament: { select: { name: true, year: true, region: true } },
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
  return {
    ownTournamentIds,
    registrationNames,
    years: own.map((o) => o.tournament.year).filter((y): y is number => y != null),
    regions: [...new Set(own.map((o) => o.tournament.region).filter((r): r is string => !!r))],
    teammates,
  };
}

const PERSON_SELECT = {
  id: true,
  displayName: true,
  claimedByUserId: true,
  suppressedAt: true,
} as const;

type CandidatePerson = {
  id: bigint;
  displayName: string;
  claimedByUserId: string | null;
  suppressedAt: Date | null;
};

async function findCandidatePersons(
  anchors: readonly string[],
): Promise<{ persons: CandidatePerson[]; truncated: boolean }> {
  const keys = [...new Set(anchors.flatMap(lookupKeys))];
  const ranges = new Map<string, PrefixRange>();
  for (const r of anchors.flatMap(prefixRanges)) ranges.set(r.gte, r);
  const [exact, ...ranged] = await Promise.all([
    prisma.person.findMany({ where: { normalizedName: { in: keys } }, select: PERSON_SELECT }),
    ...[...ranges.values()].map((r) =>
      prisma.person.findMany({
        where: { normalizedName: { gte: r.gte, lt: r.lt } },
        select: PERSON_SELECT,
        orderBy: { normalizedName: 'asc' },
        take: RANGE_CAP + 1,
      }),
    ),
  ]);
  const byId = new Map<string, CandidatePerson>();
  for (const p of [...exact, ...ranged.flat()]) byId.set(String(p.id), p);
  // Suppressed people are never candidates; stand-ins are not people.
  const persons = [...byId.values()].filter(
    (p) =>
      !p.suppressedAt && !isStandInName(p.displayName) && bestMatch(anchors, p.displayName) != null,
  );
  return { persons, truncated: ranged.some((r) => r.length > RANGE_CAP) };
}

type Participation = {
  tournamentId: bigint;
  personId: bigint;
  teamName: string | null;
  roles: { role: string }[];
  tournament: { name: string; year: number | null; region: string | null; sourceUrlRaw: string };
};

/** Tournaments per year for each name bucket, from every participation read. */
function busiestYears(
  parts: readonly Participation[],
): Map<string, { year: number; count: number }> {
  const perYear = new Map<string, Map<number, Set<string>>>();
  for (const p of parts) {
    if (p.tournament.year == null) continue;
    const years = perYear.get(String(p.personId)) ?? new Map<number, Set<string>>();
    const set = years.get(p.tournament.year) ?? new Set<string>();
    set.add(String(p.tournamentId));
    years.set(p.tournament.year, set);
    perYear.set(String(p.personId), years);
  }
  const out = new Map<string, { year: number; count: number }>();
  for (const [personId, years] of perYear) {
    let best: { year: number; count: number } | null = null;
    for (const [year, set] of years) {
      if (!best || set.size > best.count) best = { year, count: set.size };
    }
    if (best) out.set(personId, best);
  }
  return out;
}

function pushTo<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

/** Round slots and teammate sightings at the candidate tournaments. */
async function loadRoundFacts(cands: readonly Participation[], teammateIds: readonly string[]) {
  const tournamentIds = [...new Set(cands.map((c) => c.tournamentId))];
  const teams = [...new Set(cands.map((c) => c.teamName).filter((t): t is string => !!t))];
  const personIds = [...new Set(cands.map((c) => c.personId))];
  const [overlaps, teamRounds, outrounds, judging] = await Promise.all([
    teammateIds.length
      ? prisma.tournamentParticipant.findMany({
          where: { tournamentId: { in: tournamentIds }, personId: { in: teammateIds.map(BigInt) } },
          select: { tournamentId: true, personId: true, teamName: true },
        })
      : [],
    teams.length
      ? prisma.teamResult.findMany({
          where: {
            tournamentId: { in: tournamentIds },
            teamName: { in: teams },
            roundNumber: { gt: 0 },
          },
          select: { tournamentId: true, teamName: true, roundNumber: true },
        })
      : [],
    teams.length
      ? prisma.eliminationResult.findMany({
          where: {
            tournamentId: { in: tournamentIds },
            entityType: 'team',
            entityName: { in: teams },
          },
          select: { tournamentId: true, entityName: true, stage: true },
        })
      : [],
    prisma.judgeAssignment.findMany({
      where: { personId: { in: personIds }, tournamentId: { in: tournamentIds } },
      select: { tournamentId: true, personId: true, stage: true, roundNumber: true },
    }),
  ]);

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

function toAppearance(
  c: Participation,
  person: CandidatePerson,
  ctx: {
    userId: string;
    facts: UserFacts;
    rounds: Awaited<ReturnType<typeof loadRoundFacts>>;
    busiest: Map<string, { year: number; count: number }>;
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
      const mate = ctx.facts.teammates.get(s.personId);
      if (!mate) return [];
      return [{ ...mate, sameTeam: c.teamName != null && s.teamName === c.teamName }];
    });
  return {
    tournamentId: t,
    personId: p,
    tournamentName: c.tournament.name,
    year: c.tournament.year,
    region: c.tournament.region,
    publicUrl: publicTournamentUrl(c.tournament.sourceUrlRaw),
    listedName: displayNameFor(person),
    roles: c.roles.map((r) => r.role),
    teamName: c.teamName,
    claimedBy:
      person.claimedByUserId == null
        ? null
        : person.claimedByUserId === ctx.userId
          ? 'me'
          : 'other',
    slots,
    eudc: isEudcTournament(c.tournament.name),
    teammates: teammates.sort((a, b) => Number(b.sameTeam) - Number(a.sameTeam)),
    busiestYear: ctx.busiest.get(p) ?? null,
  };
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

export type FoundLoad = { input: FoundInput; rows: FoundRow[] };

/**
 * Everything /cv/found shows, and what the decision route validates against.
 * `googleName` is only a reference for the forwarded-URL check; it never
 * seeds a search.
 */
export async function loadFound(userId: string, googleName: string | null): Promise<FoundLoad> {
  const [facts, stored] = await Promise.all([loadUserFacts(userId), loadStoredDecisions(userId)]);
  const anchors = selectAnchors(facts.registrationNames, googleName);
  const decisions = new Map<string, Decision>(
    stored.map((d) => [appearanceKey(d.tournamentId, d.personId), d.status]),
  );
  const base = {
    anchorCount: anchors.usable.length,
    unsearchable: anchors.unsearchable,
    heldBack: anchors.heldBack,
  };
  if (anchors.usable.length === 0) {
    return { input: { ...base, truncated: false, rows: [], stored }, rows: [] };
  }

  const { persons, truncated } = await findCandidatePersons(anchors.usable);
  const parts: Participation[] = persons.length
    ? await prisma.tournamentParticipant.findMany({
        where: { personId: { in: persons.map((p) => p.id) } },
        select: {
          tournamentId: true,
          personId: true,
          teamName: true,
          roles: { select: { role: true } },
          tournament: { select: { name: true, year: true, region: true, sourceUrlRaw: true } },
        },
        take: PARTICIPATION_CAP + 1,
      })
    : [];
  // Tournaments the user has a private URL for go through onboarding instead.
  const cands = parts.filter((c) => !facts.ownTournamentIds.has(String(c.tournamentId)));
  const rounds = cands.length
    ? await loadRoundFacts(cands, [...facts.teammates.keys()])
    : { teamSlots: new Map(), judgeSlots: new Map(), sightings: new Map() };

  const personById = new Map(persons.map((p) => [String(p.id), p]));
  const busiest = busiestYears(parts);
  const apps = cands.flatMap((c) => {
    const person = personById.get(String(c.personId));
    return person ? [toAppearance(c, person, { userId, facts, rounds, busiest })] : [];
  });
  const rows = rankAppearances(apps, {
    anchors: anchors.usable,
    userYears: facts.years,
    userRegions: facts.regions,
    decisions,
  });
  return {
    input: { ...base, truncated: truncated || parts.length > PARTICIPATION_CAP, rows, stored },
    rows,
  };
}
