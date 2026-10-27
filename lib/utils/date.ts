/**
 * One date format for the product (audit COPY-6): "27 Oct 2026". Fixed
 * locale and zone so server and client render the same text and nothing
 * depends on the visitor's browser settings.
 */
const DATE = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

export function formatDate(value: Date | string | number): string {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? '' : DATE.format(d);
}

/** When privacy.tsx and terms.tsx were last revised. Bump on a real change. */
export const LEGAL_LAST_UPDATED = '27 Oct 2026';
