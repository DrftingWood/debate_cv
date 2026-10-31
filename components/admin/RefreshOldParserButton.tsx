'use client';

import { BulkFillView, useBulkFill, type BulkFillWords } from '@/components/admin/BulkFill';
import {
  OLD_PARSER_BATCH_SIZE,
  oldParserSummary,
  type OldParserResponse,
} from '@/lib/admin/oldParserText';

/** The words of "Refresh old-parser tournaments". It fetches, so the batch is the smaller 20. */
export const OLD_PARSER_WORDS: BulkFillWords = {
  count: 'Tournaments scraped by an older parser:',
  allDone: 'Every stored tournament was scraped by the current parser.',
  first: 'Refresh old-parser tournaments',
  next: `Refresh the next ${OLD_PARSER_BATCH_SIZE}`,
  busy: 'Refreshing…',
  hint: `${OLD_PARSER_BATCH_SIZE} at a time, oldest first.`,
  working: `Re-reading every recorded page of up to ${OLD_PARSER_BATCH_SIZE} tournaments. This can take up to a minute.`,
};

/**
 * Tools: "Refresh old-parser tournaments". Each press re-reads every recorded
 * page of the next 20 tournaments stored by an older parser through the
 * partial re-scrape (POST /api/admin/old-parser {refresh}); the route
 * re-stamps and re-audits what read fully. A tournament with a page that
 * failed stays in the pool and the cursor moves past it.
 */
export function RefreshOldParserButton({ stale }: { stale: number }) {
  const { pending, error, result, run } = useBulkFill<OldParserResponse>(
    '/api/admin/old-parser',
    'refresh',
  );
  return (
    <BulkFillView
      waiting={stale}
      words={OLD_PARSER_WORDS}
      pending={pending}
      error={error}
      result={result}
      summary={oldParserSummary}
      onRun={run}
    />
  );
}
