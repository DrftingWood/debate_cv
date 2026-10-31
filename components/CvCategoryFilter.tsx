import Link from 'next/link';
import { buttonClasses } from '@/components/ui/Button';
import { CV_CATEGORIES, CV_CATEGORY_LABELS, type CvCategory } from '@/lib/cv/categoryFilter';

/**
 * Which category the speaking chart shows (owner, 2026-10-31): All, then only
 * the categories the user has results in. Plain links, so each choice is its
 * own address (`?cat=`) and Back steps through them; the chart is rebuilt on
 * the server. Nothing renders when there is only one category to look at:
 * a filter with one option is no filter.
 */
export function CvCategoryFilter({
  active,
  counts,
  href,
}: {
  active: CvCategory | null;
  counts: Record<CvCategory, number>;
  /** The address for a category (null: all). */
  href: (cat: CvCategory | null) => string;
}) {
  const present = CV_CATEGORIES.filter((c) => counts[c] > 0);
  if (present.length < 2) return null;
  const items: { cat: CvCategory | null; label: string }[] = [
    { cat: null, label: 'All' },
    ...present.map((c) => ({ cat: c, label: CV_CATEGORY_LABELS[c] })),
  ];
  return (
    <nav aria-label="Speaking chart category" className="flex flex-wrap items-center gap-inline">
      <span className="data-label">Chart shows</span>
      {items.map(({ cat, label }) => (
        <Link
          key={label}
          href={href(cat)}
          scroll={false}
          aria-current={cat === active ? 'true' : undefined}
          className={buttonClasses({ variant: cat === active ? 'primary' : 'outline', size: 'sm' })}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
