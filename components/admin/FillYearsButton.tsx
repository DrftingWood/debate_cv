'use client';

import { BulkFillView, useBulkFill, type BulkFillWords } from '@/components/admin/BulkFill';
import { YEAR_BATCH_SIZE, yearFillSummary, type YearFillResponse } from '@/lib/admin/yearFillText';

/** The words of "Fill years from names". Nothing is fetched, so the batch is the larger 50. */
export const YEAR_WORDS: BulkFillWords = {
  count: 'Tournaments with no year:',
  allDone: 'Every stored tournament has a year.',
  first: 'Fill years from names',
  next: `Fill the next ${YEAR_BATCH_SIZE}`,
  busy: 'Filling…',
  hint: `${YEAR_BATCH_SIZE} at a time, oldest first.`,
  working: `Reading the names of up to ${YEAR_BATCH_SIZE} tournaments.`,
};

/**
 * Tools: "Fill years from names". Each press goes over the next 50
 * tournaments with no year and writes the one the name states
 * (POST /api/admin/years {fillMissing}); a name that states none stays as it
 * is, and the cursor moves past it.
 */
export function FillYearsButton({ missing }: { missing: number }) {
  const { pending, error, result, run } = useBulkFill<YearFillResponse>(
    '/api/admin/years',
    'fillMissing',
  );
  return (
    <BulkFillView
      waiting={missing}
      words={YEAR_WORDS}
      pending={pending}
      error={error}
      result={result}
      summary={yearFillSummary}
      onRun={run}
    />
  );
}
