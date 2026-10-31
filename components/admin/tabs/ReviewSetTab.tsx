import { ReviewSetSection } from '@/components/admin/ReviewSetSection';
import { loadReviewSet } from '@/lib/admin/reviewSet';
import { orNull } from '@/lib/admin/orNull';

/** Open and done flags, so "Show done" needs no second request. */
export async function ReviewSetTab({ now }: { now: Date }) {
  const flags = await loadReviewSet({ status: 'all' }).catch(orNull('review set'));
  return <ReviewSetSection flags={flags} now={now} />;
}
