/**
 * Compute a speaker's average score from the data we have, in priority
 * order:
 *
 *   1. An explicit "Average" cell on the speaker tab (some Tabbycat
 *      installs expose one).
 *   2. `speakerScoreTotal / prelimsSpoken` when both are known
 *      (BP, and AP installs with per-round columns).
 *   3. Mean of the per-round numericScores when total is unknown but
 *      individual cells parsed.
 *   4. AP fallback: `speakerScoreTotal / prelimRoundCount` when the
 *      speaker tab gave us only a total without per-round breakdown.
 *      `prelimRoundCount` comes from `Tournament.prelimRoundCount`
 *      (set at ingest from the landing nav) or from
 *      `MAX(TeamResult.roundNumber)` as a fallback.
 *
 * Returns the formatted string the CV row uses, or null when none of
 * the four paths can produce a number. Pure so the AP fallback path is
 * trivially testable without mocking buildCvData's full DB surface.
 */
export function computeSpeakerAvg(args: {
  averageCellScore: number | null;
  numericScores: number[];
  speakerScoreTotal: number | null;
  prelimRoundCount: number | null;
}): string | null {
  const { averageCellScore, numericScores, speakerScoreTotal, prelimRoundCount } = args;
  const prelimsSpoken = numericScores.length;

  if (averageCellScore != null && Number.isFinite(averageCellScore)) {
    return averageCellScore.toFixed(1);
  }
  if (
    prelimsSpoken > 0 &&
    speakerScoreTotal != null &&
    Number.isFinite(speakerScoreTotal)
  ) {
    return (speakerScoreTotal / prelimsSpoken).toFixed(1);
  }
  if (prelimsSpoken > 0) {
    const sum = numericScores.reduce((a, b) => a + b, 0);
    return (sum / prelimsSpoken).toFixed(1);
  }
  if (
    speakerScoreTotal != null &&
    Number.isFinite(speakerScoreTotal) &&
    prelimRoundCount != null &&
    prelimRoundCount > 0
  ) {
    return (speakerScoreTotal / prelimRoundCount).toFixed(1);
  }
  return null;
}
