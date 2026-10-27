import * as React from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from '@/lib/utils/cn';

/**
 * A tournament name that links out to its tab site.
 *
 * The tab opens in a new tab, and the link says so twice: a visible icon at
 * full ink (it used to sit at `opacity-0` until hover, which a phone never
 * triggers) and an sr-only "(opens in new tab)" for a screen reader (UX-43,
 * WCAG technique G201). The name is never truncated: a long tournament name
 * wraps, because a `title` tooltip is unreachable on touch (UX-36).
 *
 * Shared by the /cv ledger, the /cv mobile cards and the public CV, so a fix
 * to how a tournament link reads lands everywhere at once.
 */
export function TournamentLink({
  name,
  href,
  className,
}: {
  name: string;
  /** The public tab URL. Null renders the name as plain text. */
  href: string | null | undefined;
  className?: string;
}) {
  if (!href) {
    return <span className={cn('break-words font-medium text-ink', className)}>{name}</span>;
  }
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        'inline-flex min-h-6 items-baseline gap-1.5 break-words font-medium text-ink hover:text-primary',
        className,
      )}
    >
      <span className="min-w-0">{name}</span>
      <ExternalLink className="h-3 w-3 shrink-0 self-center text-ink-soft" aria-hidden />
      <span className="sr-only"> (opens in new tab)</span>
    </a>
  );
}

export type TournamentCardField = {
  label: string;
  value: string;
  /** Figures (scores, ranks, counts) set in the tabular mono face. */
  mono?: boolean;
  /** A second, quieter line under the value, e.g. "top 8% of the team tab". */
  hint?: string;
};

/**
 * One labelled fact on a tournament card. The value wraps rather than
 * truncating: partners and team names are the facts most likely to be long,
 * and the card is the only view of them on a phone (UX-30).
 */
export function TournamentCardField({ label, value, mono, hint }: TournamentCardField) {
  return (
    <div className="min-w-0">
      <dt className="data-label">{label}</dt>
      <dd className={cn('mt-0.5 break-words text-table text-ink', mono && 'num')}>{value}</dd>
      {hint ? <dd className="text-caption text-ink-soft">{hint}</dd> : null}
    </div>
  );
}

/**
 * The mobile form of a tournament ledger row: one panel per tournament, the
 * name and year across the top, an optional result line (the gold break
 * badge, or an outround reached), then the row's columns as a labelled grid.
 *
 * Deliberately data-agnostic: callers map their own row type to `fields`, so
 * the private record (/cv) and the public CV (/u/<slug>) can share the card
 * without either importing the other's data builders. Anything extra (a
 * round-by-round ledger, a Report button) goes in `children`, below the grid.
 */
export function TournamentCard({
  name,
  href,
  year,
  result,
  fields,
  children,
  as: Tag = 'li',
  headingAs: Heading = 'h3',
  className,
}: {
  name: string;
  href?: string | null;
  year?: number | string | null;
  /** Rendered under the title, e.g. `<Badge variant="gold">Semifinals</Badge>`. */
  result?: React.ReactNode;
  fields: TournamentCardField[];
  children?: React.ReactNode;
  /** `li` by default, because the cards always sit in a `<ul>`. */
  as?: 'li' | 'div' | 'article';
  /**
   * The name is a heading so a screen reader can jump card to card. `h3`
   * fits under a section's `h2`; a page with a different outline passes its
   * own level.
   */
  headingAs?: 'h2' | 'h3' | 'h4';
  className?: string;
}) {
  return (
    <Tag className={cn('panel p-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <Heading className="min-w-0 font-display text-h4 font-medium">
          <TournamentLink name={name} href={href} />
        </Heading>
        <span className="num shrink-0 pt-1 text-caption text-ink-soft">{year ?? '—'}</span>
      </div>
      {result ? <div className="mt-2 flex flex-wrap items-center gap-1.5">{result}</div> : null}
      {fields.length > 0 ? (
        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2.5">
          {fields.map((f) => (
            <TournamentCardField key={f.label} {...f} />
          ))}
        </dl>
      ) : null}
      {children}
    </Tag>
  );
}
