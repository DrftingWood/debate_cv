import Link from 'next/link';
import { buttonClasses } from '@/components/ui/Button';

export type ViewChip = {
  key: string;
  label: string;
  /** Rows the view holds; omitted where the figure is not known without reading them. */
  count?: number;
  href: string;
  on: boolean;
};

/**
 * The view filter of a tab (Failing / Covered by stored copy / Checked / All,
 * Problems / Informational / Checked, ...): plain links that keep the page's
 * other parameters, the chosen one marked with aria-current (UX-12). The
 * counts are over the whole tab whatever is chosen, so a chip says what
 * choosing it would show.
 */
export function ViewChips({ label, chips }: { label: string; chips: readonly ViewChip[] }) {
  return (
    <nav aria-label={label}>
      <ul className="flex flex-wrap gap-inline">
        {chips.map((c) => (
          <li key={c.key}>
            <Link
              href={c.href}
              aria-current={c.on ? 'true' : undefined}
              className={buttonClasses({ variant: c.on ? 'primary' : 'outline', size: 'sm' })}
            >
              {c.label}
              {c.count === undefined ? null : (
                <>
                  {' '}
                  <span className="font-mono tabular-nums">{c.count}</span>
                </>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
