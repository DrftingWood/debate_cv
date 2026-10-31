/**
 * The words and shapes of "Fill missing adjudication cores", apart from the
 * button so they can be tested without a DOM and imported by client code
 * without pulling in the database (coreFill.ts has it).
 */

/** Tournaments one press goes over. Each costs a fetch, so it is smaller than the format fill's 50. */
export const CORE_BATCH_SIZE = 20;

/** POST /api/admin/cores { fillMissing: true }: one batch. */
export type CoreFillResponse = {
  /** Tournaments where a core is now named, by either source. */
  found: number;
  /** Read fine, but neither the list nor the home page names anyone. */
  none: number;
  /** The page could not be read or stored; tried again by the next sweep. */
  failed: number;
  /** Tournaments still to go past this batch's last id. */
  left: number;
  /** Where the next press continues; null when nothing is left. */
  next: string | null;
};

/** "Found 12 · none named 3 · failed 1 · 40 left", the line a batch ends with. */
export function coreFillSummary(r: CoreFillResponse): string {
  return `Found ${r.found} · none named ${r.none} · failed ${r.failed} · ${r.left} left`;
}
