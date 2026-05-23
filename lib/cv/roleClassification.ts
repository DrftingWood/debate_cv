/**
 * Decide whether a `TournamentParticipant` row represents the user
 * playing the judge role in that tournament. Reads `ParticipantRole`
 * as the single source of truth.
 *
 * After sub-project 9b's backfill migration applies, every legacy
 * participant that previously satisfied the 5-signal OR (judgeTypeTag,
 * chairedPrelimRounds, lastOutroundChaired, lastOutroundPaneled, or an
 * existing 'judge' role row) has a 'judge' role row written for them.
 * New ingests already write the role row via writeJudgeParticipantRole.
 * So a single role-row check is sufficient.
 *
 * The dropped OR signals are still useful for CV display (chair counts,
 * deepest outrounds) — only their role in classification changes.
 */
export function isJudgeParticipant(p: {
  roles: ReadonlyArray<{ role: string }>;
}): boolean {
  return p.roles.some((r) => r.role === 'judge');
}
