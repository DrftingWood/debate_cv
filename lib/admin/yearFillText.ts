/**
 * The words and shapes of "Fill years from names", apart from the button so
 * they can be tested without a DOM and imported by client code without
 * pulling in the database (yearFill.ts has it).
 */

/** Tournaments one press goes over. Nothing is fetched, so it matches the format fill. */
export const YEAR_BATCH_SIZE = 50;

/** POST /api/admin/years { fillMissing: true }: one batch. */
export type YearFillResponse = {
  /** Tournaments given a year read from their name. */
  filled: number;
  /** Names that state no year, or not one year with certainty: left as they are. */
  noYear: number;
  /** Tournaments with no year past this batch's last id. */
  left: number;
  /** Where the next press continues; null when nothing is left. */
  next: string | null;
};

/** "Filled 12 · no year in name 3 · 40 left", the line a batch ends with. */
export function yearFillSummary(r: YearFillResponse): string {
  return `Filled ${r.filled} · no year in name ${r.noYear} · ${r.left} left`;
}
