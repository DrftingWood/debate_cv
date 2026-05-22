/**
 * Decide whether a `TournamentParticipant` row represents the user
 * playing the judge role in that tournament. Mirrors the 5-signal OR
 * that previously sat inlined in `buildCvData.ts`.
 *
 * The signals are OR'd because the `ParticipantRole` table is incomplete
 * by design today: only `classifyParticipantRole` (the participants-tab
 * parser) populates a 'judge' role row, while the landing-derived judge
 * writers in ingest.ts populate `judgeTypeTag` / `chairedPrelimRounds` /
 * `lastOutroundChaired` / `lastOutroundPaneled` without upserting a
 * roles row. Until the ingest decomposition sub-project makes `roles`
 * authoritative (and a backfill SQL fills in historical rows), the OR is
 * the load-bearing classifier — we just want it to live in one place.
 */
export function isJudgeParticipant(p: {
  roles: ReadonlyArray<{ role: string }>;
  judgeTypeTag: string | null;
  chairedPrelimRounds: number | null;
  lastOutroundChaired: string | null;
  lastOutroundPaneled: string | null;
}): boolean {
  return (
    p.roles.some((r) => r.role === 'judge') ||
    !!p.judgeTypeTag ||
    (p.chairedPrelimRounds ?? 0) > 0 ||
    !!p.lastOutroundChaired ||
    !!p.lastOutroundPaneled
  );
}
