/**
 * Single-source CSV cell + row formatters used by every CSV export route.
 *
 * Quoting policy: only wrap in quotes when the value contains a character
 * that would otherwise break CSV parsing (`,` / `"` / `\r` / `\n`).
 * Always-quoted output (the prior behaviour in the error-report exports)
 * inflates row size and makes diff-comparing CSV exports noisier than it
 * needs to be — consumers like Excel handle the conditional form fine.
 *
 * Formula injection (OWASP, "CSV Injection"): a spreadsheet runs a cell that
 * starts with `=`, `+`, `-`, `@`, a tab or a carriage return as a formula,
 * and exported cells carry text people typed (a review comment, a report's
 * note). Such a cell gets a leading `'`, which the spreadsheet shows as text.
 * A number is left alone, as a value or as plain signed text (`-3`, the CV
 * export's `+4.4` delta): nothing but digits cannot be a formula, and a
 * quote in front would show in the spreadsheet.
 */

const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?\d+(\.\d+)?$/;

export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const raw = String(value);
  const s =
    typeof value !== 'number' &&
    typeof value !== 'bigint' &&
    FORMULA_START.test(raw) &&
    !PLAIN_NUMBER.test(raw)
      ? `'${raw}`
      : raw;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(values: unknown[]): string {
  return values.map(csvCell).join(',');
}
