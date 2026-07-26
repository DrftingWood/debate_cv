import * as React from 'react';
import { cn } from '@/lib/utils/cn';

/**
 * Ledger table primitives. Thin wrappers over the `.ledger` rules in
 * globals.css so every table in the product shares one set of column
 * mechanics: uppercase mono headers, hairline row rules, no vertical rules,
 * and numeric columns right-aligned with tabular figures.
 *
 * `TableScroll` is not optional decoration — a statement table on a phone
 * must scroll inside its own box, never make the page scroll sideways.
 */
export function TableScroll({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  // No negative margins here. Every caller wraps this in a `.panel` with
  // `overflow-hidden`, which clips a bleed-out — the old `-mx-4 px-4` cost
  // the first 1rem of the table on narrow screens instead of buying edge
  // bleed. Plain overflow keeps the table inside its sheet.
  //
  // `scroll-shadow` (globals.css) is the affordance: a CSS-only edge shadow
  // that appears only on a side with content beyond it. Without it a table
  // that scrolls is indistinguishable from one that doesn't, which is how
  // the public CV managed to hide its Result column at every viewport
  // without anyone noticing.
  return (
    <div className={cn('scroll-shadow w-full overflow-x-auto', className)}>{children}</div>
  );
}

/**
 * `label` is not optional dressing. An audit found 92 unlabelled tables
 * across the app — /cv alone renders 26, one per tournament round ledger —
 * which leaves a screen-reader user with two dozen anonymous grids and no
 * way to tell which tournament any of them belongs to. It renders as a
 * visually-hidden <caption> rather than aria-label so the name survives
 * both assistive tech and a printed page.
 */
export function Table({
  children,
  className,
  label,
  ...rest
}: React.TableHTMLAttributes<HTMLTableElement> & { label: string }) {
  return (
    <table className={cn('ledger text-table', className)} {...rest}>
      <caption className="sr-only">{label}</caption>
      {children}
    </table>
  );
}

export function Th({
  children,
  numeric,
  className,
  ...rest
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(numeric && 'text-right', className)}
      {...rest}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  numeric,
  className,
  ...rest
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td className={cn(numeric && 'cell-num', className)} {...rest}>
      {children}
    </td>
  );
}

/**
 * Zebra-free row with a hover tint. Statement tables don't stripe — the
 * hairline rules already carry the eye — but they do respond to the pointer
 * so a wide row stays trackable across the screen.
 */
export function Tr({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr className={cn('transition-colors hover:bg-surface-2', className)} {...rest}>
      {children}
    </tr>
  );
}

/**
 * "—" for an absent figure. Never leave a numeric cell empty: a blank cell
 * reads as a rendering bug, an em dash reads as "the source didn't publish
 * this".
 */
export function Nil({ title }: { title?: string }) {
  return (
    // No opacity modifier. `ink-soft` is already the muted tier and passes
    // AA at full strength (5.31:1); at /60 this measured 2.38:1, and it is
    // the marker on every missing cell in every table in the product —
    // the single most repeated piece of text in the UI.
    <span className="text-ink-soft" title={title ?? 'Not published by the tab site'}>
      —
    </span>
  );
}
