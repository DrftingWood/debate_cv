import { Pager } from '@/components/ui/Pager';
import { ReviewSetTable, type ReviewRow } from '@/components/admin/ReviewSetTable';
import { LoadFailed } from '@/components/admin/LoadFailed';
import { adminHref, type SearchValues } from '@/lib/admin/adminHref';
import { clampPage } from '@/lib/admin/cvReportTypes';
import type { ReviewFlagView } from '@/lib/admin/reviewSet';
import { sortFlags } from '@/lib/admin/reviewSetTypes';
import { relativeTime } from '@/lib/utils/relativeTime';
import { shortUrl } from '@/lib/utils/shortUrl';
import { publicPieceUrl } from '@/lib/audit/types';

export const REVIEW_PER_PAGE = 20;

const SOURCE_LABEL: Record<ReviewFlagView['source'], string> = {
  import: 'Failed import',
  cv_report: 'CV report',
  parser_warning: 'Parser warning',
  audit_check: 'Accuracy check',
};

/**
 * What a flag is called in the ledger: its tournament when one is known,
 * else its public tab address, else what kind of item it is. A parser
 * warning goes by its `[parser] headline`, and a report with no stored
 * tournament by its reporter (Task 5d). An accuracy check goes by its
 * tournament and the check in words; one whose check no longer exists says
 * so. Never the private URL: `url` was made public when the flag was read.
 */
function nameOf(f: ReviewFlagView): string {
  if (f.source === 'audit_check') {
    return f.detail?.kind === 'audit_check'
      ? `${f.detail.tournament.name} · ${f.detail.check}`
      : 'Check no longer exists';
  }
  // A warning spans many tournaments: its headline says what it is.
  if (f.detail?.kind === 'parser_warning') return `[${f.detail.parser}] ${f.detail.headline}`;
  if (f.tournament) return f.tournament.name;
  if (f.detail?.kind === 'cv_report') {
    return `CV report from ${f.detail.reporter.name ?? f.detail.reporter.email ?? 'a user'}`;
  }
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
 * are already flagged. Null flags mean the read failed: the section says so.
 */
export function ReviewSetSection({
  flags,
  now,
  search = {},
}: {
  flags: readonly ReviewFlagView[] | null;
  now: Date;
  search?: SearchValues;
}) {
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
      {flags ? (
        <Listing flags={flags} now={now} search={search} />
      ) : (
        <LoadFailed what="the review set" />
      )}
    </section>
  );
}

const HASH = 'review-set';

/**
 * One page of the set: open flags by default, with the done ones too behind
 * "Show done" (`?review=all`), 20 a page through `?reviewPage=`. The pager
 * counts what is listed, so its total is the rows you can page through.
 */
function Listing({
  flags,
  now,
  search,
}: {
  flags: readonly ReviewFlagView[];
  now: Date;
  search: SearchValues;
}) {
  const showDone = search.review === 'all';
  const open = flags.filter((f) => f.status === 'open');
  const rows = toReviewRows(showDone ? flags : open, now);
  const pages = Math.max(1, Math.ceil(rows.length / REVIEW_PER_PAGE));
  const asked = Number.parseInt(String(search.reviewPage ?? '1'), 10);
  const page = clampPage(asked, pages);
  const shown = rows.slice((page - 1) * REVIEW_PER_PAGE, page * REVIEW_PER_PAGE);
  const reviewHref = (changes: Record<string, string | null>) => adminHref(search, changes, HASH);
  return (
    <>
      <Pager
        page={page}
        pages={pages}
        total={rows.length}
        perPage={REVIEW_PER_PAGE}
        label="Review set pages"
        href={(n) => reviewHref({ reviewPage: n > 1 ? String(n) : null })}
      />
      <ReviewSetTable
        rows={shown}
        showDone={showDone}
        doneCount={flags.length - open.length}
        anyFlags={flags.length > 0}
        toggleHref={reviewHref({ review: showDone ? null : 'all', reviewPage: null })}
      />
    </>
  );
}
