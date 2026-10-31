/**
 * The words and shapes of the format-fill buttons, apart from the buttons so
 * they can be tested without a DOM and imported by client code without
 * pulling in the database (formatFill.ts has it).
 */

/** POST /api/admin/formats { tournamentId }. */
export type InferResponse = { decided: boolean; format: string | null };

/** POST /api/admin/formats { fillMissing: true }: one batch. */
export type FillResponse = { filled: number; undecided: number; left: number; next: string | null };

/** "Filled 12 · couldn't decide 3 · 40 left", the line a batch ends with. */
export function fillSummary(r: FillResponse): string {
  return `Filled ${r.filled} · couldn't decide ${r.undecided} · ${r.left} left`;
}

/** The toast for a decided single tournament. */
export function inferredWords(format: string | null): string {
  return format ? `Format set to ${format}.` : 'This tournament already has a format.';
}

/** When the stored rows cannot settle it: say so, and name the pages to re-read. */
export const UNDECIDED_WORDS = "Stored rooms don't record sides; re-scrape R1 to decide";

/** Tournaments one press goes over; formatFill.ts shares it (a client file cannot import that one). */
export const FILL_BATCH_SIZE = 50;
