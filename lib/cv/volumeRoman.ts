type ActiveYears = { from: number; to: number } | null;

const ROMAN: Record<number, string> = {
  1: 'I',
  2: 'II',
  3: 'III',
  4: 'IV',
  5: 'V',
  6: 'VI',
  7: 'VII',
  8: 'VIII',
  9: 'IX',
};

/**
 * Derive the masthead's "VOL. X" Roman numeral from the user's active-year
 * span. A debater in their third active year sees VOL. III. Capped at IX:
 * longer Romans (X, XI...) read awkwardly in a small-caps eyebrow.
 *
 *  - `null` activeYears (no tournaments yet) → "I"
 *  - reversed span (defensive) → "I"
 *  - span ≥ 10 → "IX+"
 */
export function volumeRoman(activeYears: ActiveYears): string {
  if (!activeYears) return 'I';
  const span = activeYears.to - activeYears.from + 1;
  if (span <= 0) return 'I';
  if (span >= 10) return 'IX+';
  return ROMAN[span] ?? 'I';
}
