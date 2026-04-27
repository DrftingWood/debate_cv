export type TeamRankSignal = {
  tournamentId: bigint;
  teamName: string | null;
  rank: number | null;
  wins: number | null;
  points: { toString(): string } | null;
};

export function teamResultKey(tournamentId: bigint, teamName: string): string {
  return `${tournamentId}:${teamName}`;
}

function numericPoints(value: { toString(): string } | null): number {
  if (value == null) return Number.NEGATIVE_INFINITY;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n : Number.NEGATIVE_INFINITY;
}

function hasStandingSignal(row: TeamRankSignal): boolean {
  return row.wins != null || Number.isFinite(numericPoints(row.points));
}

export function buildTeamRankLookup(rows: TeamRankSignal[]): Map<string, number> {
  const ranks = new Map<string, number>();
  const byTournament = new Map<bigint, TeamRankSignal[]>();

  for (const row of rows) {
    if (!row.teamName) continue;
    const key = teamResultKey(row.tournamentId, row.teamName);
    if (row.rank != null) ranks.set(key, row.rank);
    const group = byTournament.get(row.tournamentId) ?? [];
    group.push(row);
    byTournament.set(row.tournamentId, group);
  }

  for (const group of byTournament.values()) {
    const sorted = group
      .filter((row) => row.teamName && hasStandingSignal(row));
    if (sorted.length < 2) continue;

    sorted
      .sort((a, b) => {
        const winsDelta = (b.wins ?? Number.NEGATIVE_INFINITY) - (a.wins ?? Number.NEGATIVE_INFINITY);
        if (winsDelta !== 0) return winsDelta;
        const pointsDelta = numericPoints(b.points) - numericPoints(a.points);
        if (pointsDelta !== 0) return pointsDelta;
        return (a.teamName ?? '').localeCompare(b.teamName ?? '');
      });

    let previousWins: number | null = null;
    let previousPoints: number | null = null;
    let previousRank = 0;

    sorted.forEach((row, index) => {
      if (!row.teamName) return;
      const key = teamResultKey(row.tournamentId, row.teamName);
      if (ranks.has(key)) return;

      const wins = row.wins ?? Number.NEGATIVE_INFINITY;
      const points = numericPoints(row.points);
      const rank =
        index > 0 && wins === previousWins && points === previousPoints
          ? previousRank
          : index + 1;

      ranks.set(key, rank);
      previousWins = wins;
      previousPoints = points;
      previousRank = rank;
    });
  }

  return ranks;
}
