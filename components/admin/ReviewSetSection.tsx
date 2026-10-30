import { ReviewSetTable, type ReviewRow } from '@/components/admin/ReviewSetTable';
import type { ReviewFlagView } from '@/lib/admin/reviewSet';
import { sortFlags } from '@/lib/admin/reviewSetTypes';
import { relativeTime } from '@/lib/utils/relativeTime';
import { shortUrl } from '@/lib/utils/shortUrl';
import { publicPieceUrl } from '@/lib/audit/types';

const SOURCE_LABEL: Record<ReviewFlagView['source'], string> = {
  import: 'Failed import',
  cv_report: 'CV report',
  parser_warning: 'Parser warning',
};

/**
 * What a flag is called in the ledger: its tournament when one is known,
 * else its public tab address, else what kind of item it is. Never the
 * private URL: `url` was made public when the flag was read.
 */
function nameOf(f: ReviewFlagView): string {
  if (f.tournament) return f.tournament.name;
  if (f.url) return shortUrl(f.url);
  return `${SOURCE_LABEL[f.source]} ${f.sourceId}`;
}

/**
 * Server side of "Flagged for review": each flag as a row the client table
 * shows as it is, high to low and oldest first (what has waited longest
 * reads first), with times in words against the page's clock. The address
 * goes through publicPieceUrl once more here, at the last step before the
 * client: whatever a client component is handed is serialised into the page.
 */
export function toReviewRows(flags: readonly ReviewFlagView[], now: Date): ReviewRow[] {
  return sortFlags(flags, 'oldest').map((f) => ({
    id: f.id,
    priority: f.priority,
    status: f.status,
    comment: f.comment,
    name: nameOf(f),
    kind: SOURCE_LABEL[f.source],
    href: f.url ? publicPieceUrl(f.url) : null,
    tab: f.tab,
    flagged: { text: relativeTime(f.createdAt, now), iso: f.createdAt.toISOString() },
  }));
}

/**
 * "Flagged for review" on /admin, after Failed imports (owner, 2026-10-31:
 * "a separate set that you can later pick for review"). The page loads the
 * set once and hands it here and to Failed imports, whose rows show which
 * are already flagged.
 */
export function ReviewSetSection({ flags, now }: { flags: readonly ReviewFlagView[]; now: Date }) {
  return (
    <section aria-labelledby="review-set" className="space-y-stack rounded-lg border p-panel">
      <div>
        <h2 id="review-set" className="font-display text-h3 font-medium text-ink">
          Flagged for review
        </h2>
        <p className="mt-hair text-body text-ink-soft">
          Items set aside for a closer look, highest priority first and then the longest waiting.
          Export the set to hand it to whoever picks it up.
        </p>
      </div>
      <ReviewSetTable rows={toReviewRows(flags, now)} />
    </section>
  );
}
