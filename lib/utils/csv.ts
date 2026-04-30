/**
 * Single-source CSV cell + row formatters used by every CSV export route.
 *
 * Quoting policy: only wrap in quotes when the value contains a character
 * that would otherwise break CSV parsing (`,` / `"` / `\r` / `\n`).
 * Always-quoted output (the prior behaviour in the error-report exports)
 * inflates row size and makes diff-comparing CSV exports noisier than it
 * needs to be — consumers like Excel handle the conditional form fine.
 */

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const s = String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(',');
}
