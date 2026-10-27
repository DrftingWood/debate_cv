/**
 * Filters for /cv/stats, and how they narrow the data every section reads.
 *
 * Rather than re-implement each statistics section over the round table,
 * the filter narrows the CV data itself and the existing engine
 * (computeSpeakerStats) runs again on what is left. Every section keeps the
 * semantics its own tests already pin; the round table's job is only to say
 * which rounds and tournaments match.
 *
 *   partner   tournaments where any chosen partner (by person key) was on the team
 *   pairing   tournaments with a chosen pro-am label (pro / am / peers)
 *   seat      rounds debated from a chosen seat, e.g. 'BP:CG', 'AP:Gov'
 *
 * Choices within a dimension combine with OR, dimensions with AND. A seat is
 * a fact about a round, so a seat filter keeps a tournament but only the
 * prelim rounds from that seat — which makes tournament-level figures (breaks,
 * placement, the tab's own average) meaningless under it. The page greys
 * those sections out rather than show them; this function drops the tab's
 * average cell so no per-speech figure is computed from it.
 *
 * Judging and motions are never filtered: a judging record has no partner or
 * seat, and motions are joined to whichever rounds remain.
 */

import type { CvData } from '@/lib/cv/buildCvData';
import type { ProAm, StatsFacts } from '@/lib/cv/statsFacts';

export type StatsFilter = {
  partners: string[];
  pairings: ProAm[];
  seats: string[];
};

export const EMPTY_FILTER: StatsFilter = { partners: [], pairings: [], seats: [] };

const PAIRINGS: readonly ProAm[] = ['pro', 'am', 'peers'];

type FilterableData = Pick<CvData, 'speakerRows' | 'judgeRows' | 'taggedMotions' | 'fieldStats'>;

export function parseStatsFilter(params: URLSearchParams): StatsFilter {
  const values = (key: string) => [...new Set(params.getAll(key).map((v) => v.trim()).filter(Boolean))];
  return {
    partners: values('partner'),
    pairings: values('pairing').filter((v): v is ProAm => (PAIRINGS as readonly string[]).includes(v)),
    seats: values('seat'),
  };
}

export function serializeStatsFilter(filter: StatsFilter): string {
  const params = new URLSearchParams();
  for (const p of filter.partners) params.append('partner', p);
  for (const p of filter.pairings) params.append('pairing', p);
  for (const s of filter.seats) params.append('seat', s);
  return params.toString();
}

export function isFilterActive(filter: StatsFilter): boolean {
  return filter.partners.length > 0 || filter.pairings.length > 0 || filter.seats.length > 0;
}

export function filterCvData<T extends FilterableData>(data: T, facts: StatsFacts, filter: StatsFilter): T {
  if (!isFilterActive(filter)) return data;

  const tournamentMatches = new Set(
    facts.tournaments
      .filter(
        (t) =>
          (filter.partners.length === 0 || t.partners.some((p) => filter.partners.includes(p))) &&
          (filter.pairings.length === 0 || (t.proAm != null && filter.pairings.includes(t.proAm))),
      )
      .map((t) => t.tournamentId),
  );

  const roundsBySeat = new Map<string, Set<number>>();
  if (filter.seats.length > 0) {
    for (const r of facts.rounds) {
      if (r.isOutround || !r.seat || !filter.seats.includes(r.seat)) continue;
      const set = roundsBySeat.get(r.tournamentId) ?? new Set<number>();
      set.add(r.round);
      roundsBySeat.set(r.tournamentId, set);
    }
  }

  const speakerRows = data.speakerRows.flatMap((row) => {
    const id = row.tournamentId.toString();
    if (!tournamentMatches.has(id)) return [];
    if (filter.seats.length === 0) return [row];
    const keep = roundsBySeat.get(id);
    if (!keep || keep.size === 0) return [];
    return [
      {
        ...row,
        roundScores: row.roundScores.filter((s) => keep.has(s.roundNumber)),
        teamRoundResults: row.teamRoundResults.filter((r) => keep.has(r.roundNumber)),
      },
    ];
  });

  const kept = new Set(speakerRows.map((r) => r.tournamentId.toString()));
  return {
    ...data,
    speakerRows,
    fieldStats: data.fieldStats.filter((f) => kept.has(f.tournamentId.toString())),
  };
}

/**
 * Findings that rest on whole tournaments (placement, breaks, field size) or
 * on the order of rounds (momentum, streaks). Under a seat filter the
 * remaining rounds are a slice of each tournament, so these would still print
 * a confident number that no longer means anything — they are withheld.
 */
const TOURNAMENT_LEVEL_QUIRKS = new Set(['momentum', 'streak', 'team-percentile', 'field-percentile', 'field-size', 'break-rate', 'straights']);

/**
 * Findings the filterable page supersedes, whatever the filter. Both rest on
 * tables the page no longer shows (the engine's mixed-format seat table and
 * the tag-based stem table) and compare across formats: "Opp is your
 * strongest seat at 73% and CO your weakest" set a two-team side against a
 * BP seat and matched no table on the page. Positions and the cross-tab
 * findings answer the same questions within a format.
 */
const SUPERSEDED_QUIRKS = new Set(['seat-spread', 'motion-type']);

export function visibleQuirkIds(ids: string[], filter: StatsFilter): string[] {
  return ids.filter(
    (id) => !SUPERSEDED_QUIRKS.has(id) && (filter.seats.length === 0 || !TOURNAMENT_LEVEL_QUIRKS.has(id)),
  );
}

/**
 * The round table narrowed by the same rules as filterCvData, for the
 * sections that read it directly (positions, teammates, motion types).
 */
export function filterFacts(facts: StatsFacts, filter: StatsFilter): StatsFacts {
  if (!isFilterActive(filter)) return facts;
  const tournamentOk = (t: StatsFacts['tournaments'][number]) =>
    (filter.partners.length === 0 || t.partners.some((p) => filter.partners.includes(p))) &&
    (filter.pairings.length === 0 || (t.proAm != null && filter.pairings.includes(t.proAm)));

  const tournamentIds = new Set(facts.tournaments.filter(tournamentOk).map((t) => t.tournamentId));
  const rounds = facts.rounds.filter(
    (r) =>
      tournamentIds.has(r.tournamentId) &&
      (filter.seats.length === 0 || (!r.isOutround && r.seat != null && filter.seats.includes(r.seat))),
  );
  const withRounds = new Set(rounds.map((r) => r.tournamentId));
  const tournaments = facts.tournaments.filter(
    (t) => tournamentIds.has(t.tournamentId) && (filter.seats.length === 0 || withRounds.has(t.tournamentId)),
  );
  return { ...facts, rounds, tournaments };
}
