/**
 * Resolve the prelim-round count for a tournament from the known sources,
 * applied in priority order:
 *
 *   1. `Tournament.prelimRoundCount` — set at ingest time from the
 *      authoritative landing-nav round list. Most reliable.
 *   2. `MAX(TeamResult.roundNumber)` for prelim rounds — fallback for
 *      tournaments ingested before #1 was added to the schema.
 *   3. `MAX(SpeakerRoundScore.roundNumber)` across every participant on
 *      the tab — last resort, for tournaments that published a speaker tab
 *      with per-round columns but no per-round team results and no nav
 *      round list. Without it those tournaments have no divisor at all,
 *      which silently blanks every score-unit field figure (field mean,
 *      σ, Δ, z) while the rank-based placement still renders — a row of
 *      dashes next to a real number, with nothing explaining why.
 *
 * Note that #3 is deliberately the max across ALL speakers, not the
 * user's own scored-round count: a speaker who swung or missed a round
 * would otherwise pull the divisor below the true prelim count and inflate
 * every average computed from it.
 *
 * The rule is "first positive wins". Zero, null, and negative are all
 * treated as "missing", matching the `> 0` guard the buildCvData.ts read
 * path carried before extraction.
 *
 * Pure function — no DB access. The caller sources each input.
 */
export function pickPrelimRoundCount(args: {
  stored: number | null;
  maxTeamRoundNumber: number | null;
  maxSpeakerRoundNumber?: number | null;
}): number | null {
  if (args.stored != null && args.stored > 0) return args.stored;
  if (args.maxTeamRoundNumber != null && args.maxTeamRoundNumber > 0) {
    return args.maxTeamRoundNumber;
  }
  if (args.maxSpeakerRoundNumber != null && args.maxSpeakerRoundNumber > 0) {
    return args.maxSpeakerRoundNumber;
  }
  return null;
}
