/**
 * BP-style tournaments often run multiple break categories (Open + ESL +
 * EFL + sometimes Novice): one team can appear in more than one break
 * tab. The CV picks ONE (rank, stage) pair to show per team —
 * historically that was "first observed", but URL-fetch order put EFL
 * before Open alphabetically so the wrong category sometimes won. Pick
 * by category priority instead: Open beats ESL beats EFL beats Novice
 * beats anything else (regional categories like U21 / Pro-Am do exist
 * but are rare — they fall into the "other" bucket below ranked Novice).
 *
 * EUDC quirk: a team that qualifies for the ESL break also debates in
 * the Open break in parallel (same prelim tab feeds both). Picking a
 * single category is therefore lossy for those teams — `breaksByTeam`
 * preserves the full list so callers can surface e.g. "Open #14 · ESL
 * #6" when both apply.
 *
 * Pure so the priority order can be tested without exercising the full
 * ingest pipeline. Lives separate from ingest.ts so future changes to
 * the priority list only touch one module + its tests.
 */

export function breakCategoryPriority(stage: string | null): number {
  if (!stage) return 0;
  if (stage === 'Open') return 100;
  if (stage === 'ESL') return 80;
  if (stage === 'EFL') return 60;
  if (stage === 'Novice') return 50;
  return 40;
}

export type BreakRowLike = {
  entityType: 'team' | 'adjudicator';
  entityName: string;
  rank: number | null;
  stage?: string | null;
};

export type TeamBreakEntry = { stage: string | null; rank: number };

/**
 * Reduce a list of break rows to a per-team `(rank, stage)` answer using
 * the priority function above. Returns three parallel maps:
 *   - rankByTeam / stageByTeam: the single highest-priority break, used
 *     by the CV's break badge.
 *   - breaksByTeam: every category the team broke in, sorted by
 *     priority descending. Lets EUDC-style dual breaks (Open + ESL on
 *     the same team) be displayed in full instead of collapsed to one.
 */
export function resolveTeamBreaks(rows: BreakRowLike[]): {
  rankByTeam: Map<string, number>;
  stageByTeam: Map<string, string | null>;
  breaksByTeam: Map<string, TeamBreakEntry[]>;
} {
  const rankByTeam = new Map<string, number>();
  const stageByTeam = new Map<string, string | null>();
  const breaksByTeam = new Map<string, TeamBreakEntry[]>();
  for (const row of rows) {
    if (row.entityType !== 'team' || row.rank == null) continue;
    const stage = row.stage ?? null;
    const newPriority = breakCategoryPriority(stage);
    const existingPriority = breakCategoryPriority(stageByTeam.get(row.entityName) ?? null);
    if (!rankByTeam.has(row.entityName) || newPriority > existingPriority) {
      rankByTeam.set(row.entityName, row.rank);
      stageByTeam.set(row.entityName, stage);
    }
    const list = breaksByTeam.get(row.entityName) ?? [];
    if (!list.some((e) => e.stage === stage)) {
      list.push({ stage, rank: row.rank });
      list.sort((a, b) => breakCategoryPriority(b.stage) - breakCategoryPriority(a.stage));
      breaksByTeam.set(row.entityName, list);
    }
  }
  return { rankByTeam, stageByTeam, breaksByTeam };
}
