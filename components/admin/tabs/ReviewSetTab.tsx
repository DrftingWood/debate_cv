import { ReviewSetSection } from '@/components/admin/ReviewSetSection';
import { loadReviewSet } from '@/lib/admin/reviewSet';
import { orNull } from '@/lib/admin/orNull';
import type { SearchValues } from '@/lib/admin/adminHref';

/**
 * Open and done flags are read together, so "Show done" (`?review=all`) needs
 * no second request; the section lists one page of whichever is chosen.
 */
export async function ReviewSetTab({ search, now }: { search: SearchValues; now: Date }) {
  const flags = await loadReviewSet({ status: 'all' }).catch(orNull('review set'));
  return <ReviewSetSection flags={flags} now={now} search={search} />;
}
