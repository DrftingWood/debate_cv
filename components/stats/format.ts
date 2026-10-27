/**
 * Signed figures for the /cv/stats views, in one place.
 *
 * Sign by what the number ROUNDS to, not by its raw sign. Signing first
 * produced a green "−0.0" (a raw −0.03 shown at one decimal) and "+0pp": a
 * signed zero reads as a real difference the table is too coarse to show,
 * which is the opposite of the truth. The same rule decides the colour, so
 * a figure that prints as 0 is never green or red (Ledger §6: colour on a
 * number means up or down, and 0 is neither).
 *
 * This replaces four private copies that had drifted apart: three rounded
 * first, one (StatsSections) did not.
 */
export function signed(n: number, digits = 1): string {
  const rounded = Number(n.toFixed(digits));
  const sign = rounded > 0 ? '+' : rounded < 0 ? '−' : '';
  return `${sign}${Math.abs(rounded).toFixed(digits)}`;
}

/** `signed`, passing null through for "not published". */
export function signedOrNull(n: number | null | undefined, digits = 1): string | null {
  return n == null ? null : signed(n, digits);
}

/** The `.val-*` class for a delta shown at `digits` decimals. */
export function deltaTone(n: number, digits = 1): 'val-pos' | 'val-neg' | 'val-flat' {
  const rounded = Number(n.toFixed(digits));
  return rounded > 0 ? 'val-pos' : rounded < 0 ? 'val-neg' : 'val-flat';
}
