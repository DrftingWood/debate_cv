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

/**
 * EUDC-style outround stage labels embed the break category as a prefix
 * ("ESL Grand Final", "EFL Octofinals"); the Open category uses bare
 * labels ("Octofinals", "Grand Final"). Splits the prefix off so callers
 * can group outround appearances by category.
 *
 * Returns `category: null` when the stage is unparseable (caller treats
 * it as "Open" by convention; see `deepestOutroundsByCategory`).
 */
export function splitOutroundStage(stage: string | null | undefined): {
  category: string | null;
  baseStage: string | null;
} {
  if (!stage) return { category: null, baseStage: null };
  const trimmed = stage.trim();
  // Match a leading category token followed by whitespace, then the rest
  // of the label. Anchored so we only strip a known prefix — random
  // capitalised words at the start (e.g. a tournament-specific stage
  // name) are left intact.
  const match = trimmed.match(/^(Open|ESL|EFL|Novice)\s+(.+)$/i);
  if (match) {
    const category = match[1]!;
    // Normalise capitalisation: "esl final" → "ESL".
    const normalised =
      category.toUpperCase() === 'ESL' || category.toUpperCase() === 'EFL'
        ? category.toUpperCase()
        : category[0]!.toUpperCase() + category.slice(1).toLowerCase();
    return { category: normalised, baseStage: match[2]!.trim() };
  }
  return { category: null, baseStage: trimmed };
}

/**
 * EUDC-only helper: the same team typically debates in both the Open
 * and ESL outround brackets, hitting different "deepest reached" stages
 * in each (e.g. lost Open Octos but reached ESL Grand Final). Groups a
 * raw list of outround stages by category and picks the deepest stage
 * per category.
 *
 * `rankFn` is injected so this module stays free of a dependency on
 * judgeStats. Pass `outroundRank({roundLabel, roundNumber: null,
 * isOutround: true})` from the call site.
 *
 * Stages with no detectable category prefix are bucketed under "Open"
 * — at EUDC the Open bracket is the implicit default and its rounds
 * appear as bare "Octofinals" / "Grand Final".
 *
 * Returns entries sorted by category priority descending so the
 * highest-priority break (Open) is always rendered first.
 */
export type CategoryOutround = { category: string; stage: string };

export function deepestOutroundsByCategory(
  stages: Array<string | null | undefined>,
  rankFn: (stage: string) => number,
): CategoryOutround[] {
  const deepestByCategory = new Map<string, { stage: string; rank: number }>();
  for (const stage of stages) {
    if (!stage) continue;
    const { category } = splitOutroundStage(stage);
    const cat = category ?? 'Open';
    const rank = rankFn(stage);
    if (!Number.isFinite(rank) || rank <= 0) continue;
    const existing = deepestByCategory.get(cat);
    if (!existing || rank > existing.rank) {
      deepestByCategory.set(cat, { stage, rank });
    }
  }
  return Array.from(deepestByCategory.entries())
    .map(([category, { stage }]) => ({ category, stage }))
    .sort((a, b) => breakCategoryPriority(b.category) - breakCategoryPriority(a.category));
}

/**
 * EUDC tournaments are the canonical case where a team breaks in
 * multiple categories simultaneously. Detection is name-based — we
 * don't have a structured "circuit" field on Tournament. Matches both
 * the acronym and the long form ("European Universities Debating
 * Championship"); deliberately strict so EUDC-Asia, EUDS, etc. don't
 * get caught.
 */
export function isEudcTournament(name: string | null | undefined): boolean {
  if (!name) return false;
  return /\beudc\b|european\s+universit(?:y|ies)\s+debating/i.test(name);
}
