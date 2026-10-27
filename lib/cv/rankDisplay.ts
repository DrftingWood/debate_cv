/**
 * Tied ranks read "5=", as the tab prints them (owner decision, assumptions
 * I17). The tie marker is display-only: the stored and sorted value stays the
 * plain number, so every comparison, sort and percentile is unchanged and
 * "5=" never has to be parsed back.
 *
 * The parser drops the "=" when it stores a rank (changing that would need a
 * schema change and a PARSER_VERSION bump), so a tie is DERIVED where the CV is
 * built: a team rank is tied when another team on the same tab holds the same
 * rank; a speaker rank when another speaker has the same total.
 */

/** "5=" for a tied rank, "5" otherwise. */
export function rankLabel(rank: number, tied: boolean | null | undefined): string {
  return tied ? `${rank}=` : String(rank);
}

/** "#5=" / "#5": the form every ledger cell and export uses. */
export function hashRank(rank: number, tied: boolean | null | undefined): string {
  return `#${rankLabel(rank, tied)}`;
}

/**
 * Which ranks are shared. Input: every competitor's rank on one tab. Returns
 * the set of rank values held by two or more competitors.
 */
export function tiedRanks(ranks: Iterable<number | null | undefined>): Set<number> {
  const seen = new Map<number, number>();
  for (const r of ranks) {
    if (r == null) continue;
    seen.set(r, (seen.get(r) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([r]) => r));
}
