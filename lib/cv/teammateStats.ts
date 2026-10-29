/**
 * Teammates, over the round and tournament tables: who you debated with, how
 * many of those pairings you marked pro-am (the Record's Partners tab; never
 * inferred), and your figures with them.
 *
 * Deliberately your figures, not the partner's. In three-a-side formats a
 * round's partner speeches cannot be tied to one named teammate, so a
 * per-partner "their average" would be a guess; the tournament gap (your
 * average against your partners' mean, from lib/cv/statsFacts.ts) is the
 * honest comparison and is shown instead.
 */

import type { ProAm, StatsFacts } from '@/lib/cv/statsFacts';

export type PartnerRow = {
  /** Person key — two partners can share a display name. */
  key: string;
  name: string;
  tournaments: number;
  breaks: number;
  pairings: Record<ProAm | 'unlabelled', number>;
  /** Mean score gap to the partner over the tournaments where one could be measured. */
  meanGap: number | null;
  avgScore: number | null;
  decided: number;
  wins: number;
  winRate: number | null;
};

export type PairingSummary = {
  label: ProAm;
  tournaments: number;
  breaks: number;
  avgScore: number | null;
  decided: number;
  wins: number;
  winRate: number | null;
};

const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null;

function roundFigures(rounds: StatsFacts['rounds']) {
  const prelims = rounds.filter((r) => !r.isOutround);
  const decided = prelims.filter((r) => r.won != null);
  const wins = decided.filter((r) => r.won).length;
  return {
    avgScore: mean(prelims.flatMap((r) => (r.score != null ? [r.score] : []))),
    decided: decided.length,
    wins,
    winRate: decided.length ? wins / decided.length : null,
  };
}

export function teammateStats(facts: StatsFacts): {
  partners: PartnerRow[];
  pairings: PairingSummary[];
} {
  const roundsByTournament = new Map<string, StatsFacts['rounds']>();
  for (const r of facts.rounds) {
    const list = roundsByTournament.get(r.tournamentId) ?? [];
    list.push(r);
    roundsByTournament.set(r.tournamentId, list);
  }
  const roundsFor = (ids: string[]) => ids.flatMap((id) => roundsByTournament.get(id) ?? []);

  const byPartner = new Map<string, StatsFacts['tournaments']>();
  for (const t of facts.tournaments) {
    for (const key of new Set(t.partners)) {
      const list = byPartner.get(key) ?? [];
      list.push(t);
      byPartner.set(key, list);
    }
  }

  const partners: PartnerRow[] = [...byPartner]
    .map(([key, ts]) => {
      const gaps = ts.flatMap((t) => (t.partnerGap != null ? [t.partnerGap] : []));
      return {
        key,
        name: facts.partnerNames[key] ?? key,
        tournaments: ts.length,
        breaks: ts.filter((t) => t.broke).length,
        pairings: {
          marked: ts.filter((t) => t.proAm === 'marked').length,
          unmarked: ts.filter((t) => t.proAm === 'unmarked').length,
          unlabelled: ts.filter((t) => t.proAm == null).length,
        },
        meanGap: mean(gaps),
        ...roundFigures(roundsFor(ts.map((t) => t.tournamentId))),
      };
    })
    .sort((a, b) => b.tournaments - a.tournaments || a.name.localeCompare(b.name));

  const pairings: PairingSummary[] = (['marked', 'unmarked'] as const).flatMap((label) => {
    const ts = facts.tournaments.filter((t) => t.proAm === label);
    if (ts.length === 0) return [];
    return [
      {
        label,
        tournaments: ts.length,
        breaks: ts.filter((t) => t.broke).length,
        ...roundFigures(roundsFor(ts.map((t) => t.tournamentId))),
      },
    ];
  });

  return { partners, pairings };
}
