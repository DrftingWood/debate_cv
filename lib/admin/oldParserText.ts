/**
 * The words and shapes of "Refresh old-parser tournaments", apart from the
 * button so they can be tested without a DOM and imported by client code
 * without pulling in the database (oldParserFill.ts has it).
 */

/** Tournaments one press goes over. Each re-reads every recorded page, so it is the core fill's 20. */
export const OLD_PARSER_BATCH_SIZE = 20;

/** POST /api/admin/old-parser { refresh: true }: one batch. */
export type OldParserResponse = {
  /** Every recorded page re-read; the tournament is now stamped with the current parser. */
  refreshed: number;
  /** A page could not be read or stored; the tournament keeps its old stamp and stays in the pool. */
  failed: number;
  /** Tournaments still to go past this batch's last id. */
  left: number;
  /** Where the next press continues; null when nothing is left. */
  next: string | null;
};

/** "Refreshed 12 · failed 1 · 40 left", the line a batch ends with. */
export function oldParserSummary(r: OldParserResponse): string {
  return `Refreshed ${r.refreshed} · failed ${r.failed} · ${r.left} left`;
}
