/**
 * Resolve the prelim-round count for a tournament from the two known
 * sources, applied in priority order:
 *
 *   1. `Tournament.prelimRoundCount` — set at ingest time from the
 *      authoritative landing-nav round list. Most reliable.
 *   2. `MAX(TeamResult.roundNumber)` for prelim rounds — fallback for
 *      tournaments ingested before #1 was added to the schema.
 *
 * The rule is "first positive wins". Zero, null, and negative are all
 * treated as "missing", matching the `> 0` guard the buildCvData.ts
 * read path carried before extraction.
 *
 * Pure function — no DB access. The caller is responsible for sourcing
 * both inputs.
 */
export function pickPrelimRoundCount(args: {
  stored: number | null;
  maxTeamRoundNumber: number | null;
}): number | null {
  if (args.stored != null && args.stored > 0) return args.stored;
  if (args.maxTeamRoundNumber != null && args.maxTeamRoundNumber > 0) {
    return args.maxTeamRoundNumber;
  }
  return null;
}
