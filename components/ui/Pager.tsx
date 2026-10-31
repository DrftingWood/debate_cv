import Link from 'next/link';
import { buttonClasses } from '@/components/ui/Button';

/**
 * Page links for a paged list: "21–40 of 45 · page 2 of 3", with Previous
 * and Next. Plain links, so each page is its own URL and the browser's Back
 * steps through them. Born as the motion archive's pager and shared since
 * the admin tournament list needed the same thing (Task 5b), so the two
 * read alike. Nothing renders for a single page: there is nowhere to go.
 *
 * `href` builds a page's address, so the caller decides what else the URL
 * keeps (the admin list keeps its search). `label` names the nav (UX-11):
 * two pagers on one screen reader's landmark list must be told apart.
 *
 * `always` keeps the count line on a single page (the admin ledgers say how
 * many rows exist even when they all fit, Task 5d), still without links.
 */
export function Pager({
  page,
  pages,
  total,
  perPage,
  label,
  href,
  always = false,
}: {
  page: number;
  pages: number;
  total: number;
  perPage: number;
  label: string;
  href: (page: number) => string;
  always?: boolean;
}) {
  if (pages <= 1) {
    if (!always || total === 0) return null;
    return (
      <p className="border-y border-border py-tight font-mono text-caption text-ink-soft">
        {rangeText(page, perPage, total)}
      </p>
    );
  }
  return (
    <nav
      aria-label={label}
      className="flex flex-wrap items-center justify-between gap-tight border-y border-border py-tight"
    >
      <span className="font-mono text-caption text-ink-soft">
        {rangeText(page, perPage, total)} · page {page} of {pages}
      </span>
      <span className="flex items-center gap-inline">
        {page > 1 ? (
          <Link href={href(page - 1)} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            ← Previous
          </Link>
        ) : null}
        {page < pages ? (
          <Link href={href(page + 1)} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
            Next →
          </Link>
        ) : null}
      </span>
    </nav>
  );
}

/** "21–40 of 87": the rows a page shows, of how many. */
export function rangeText(page: number, perPage: number, total: number): string {
  if (total <= 0) return '0 of 0';
  const from = (page - 1) * perPage;
  return `${from + 1}–${Math.min(from + perPage, total)} of ${total}`;
}
