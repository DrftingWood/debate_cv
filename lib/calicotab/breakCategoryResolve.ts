/**
 * BP-style tournaments often run multiple break categories (Open + ESL +
 * EFL): one team can appear in more than one break tab. The CV picks ONE
 * (rank, stage) pair to show per team — historically that was "first
 * observed", but URL-fetch order put EFL before Open alphabetically so
 * the wrong category sometimes won. Pick by category priority instead:
 * Open beats ESL beats EFL beats anything else.
 *
 * Pure so the priority order can be tested without exercising the full
 * ingest pipeline. Lives separate from ingest.ts so future changes to
 * the priority list (e.g., adding "Novice", treating regional categories
 * specially) only touch one module + its tests.
 */

export function breakCategoryPriority(stage: string | null): number {
  if (!stage) return 0;
  if (stage === 'Open') return 100;
  if (stage === 'ESL') return 80;
  if (stage === 'EFL') return 60;
  return 40;
}

export type BreakRowLike = {
  entityType: 'team' | 'adjudicator';
  entityName: string;
  rank: number | null;
  stage?: string | null;
};

/**
 * Reduce a list of break rows to a per-team `(rank, stage)` answer using
 * the priority function above. Returns two parallel maps so callers can
 * surface both the rank and which category produced it (the CV's break
 * badge uses both).
 */
export function resolveTeamBreaks(rows: BreakRowLike[]): {
  rankByTeam: Map<string, number>;
  stageByTeam: Map<string, string | null>;
} {
  const rankByTeam = new Map<string, number>();
  const stageByTeam = new Map<string, string | null>();
  for (const row of rows) {
    if (row.entityType !== 'team' || row.rank == null) continue;
    const newPriority = breakCategoryPriority(row.stage ?? null);
    const existingPriority = breakCategoryPriority(stageByTeam.get(row.entityName) ?? null);
    if (!rankByTeam.has(row.entityName) || newPriority > existingPriority) {
      rankByTeam.set(row.entityName, row.rank);
      stageByTeam.set(row.entityName, row.stage ?? null);
    }
  }
  return { rankByTeam, stageByTeam };
}
