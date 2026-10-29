import Link from 'next/link';
import type { ReactNode } from 'react';
import { CheckCircle, Clock, Link as LinkIcon, UserFocus } from '@/components/ui/icons';
import { REVIEW_HREF } from '@/components/FoundReview';
import { deadLinksText, type ImportFilterKey } from '@/lib/ingest/importRows';
import { cn } from '@/lib/utils/cn';

/*
 * The Imports page as stages (redesign, owner decision 2026-10-29):
 * Sources → In progress → Review → On record. Each stage is one tile and
 * one link (UX research: one real link per card), in the order a URL moves
 * through them, so the page reads as a pipeline rather than four unrelated
 * counters.
 *
 * Failures are not a stage, they are a problem inside "In progress", so
 * they get their own line under the strip instead of a fifth tile or a
 * second link inside a card.
 */

export type ImportCounts = Record<ImportFilterKey, number>;

/** What the page is showing: a filtered table, the Review view, or the summary. */
export type ImportsView = ImportFilterKey | 'review' | null;

type Stage = {
  key: string;
  label: string;
  value: number;
  hint: string;
  href: string;
  icon: ReactNode;
  /** Tints the icon only; a count is not a value judgement (Ledger rule 3). */
  tone: string;
  current: boolean;
};

export function ImportsStages({
  counts,
  view,
  discovery,
}: {
  counts: ImportCounts;
  view: ImportsView;
  /** The Found search is on for this user, so Review also holds public-tab matches. */
  discovery: boolean;
}) {
  const stages: Stage[] = [
    {
      key: 'sources',
      label: 'Sources',
      value: counts.all,
      hint: 'private URLs from Gmail, links and CSV',
      href: '/dashboard?filter=all',
      icon: <LinkIcon className="h-4 w-4" aria-hidden />,
      tone: 'text-primary',
      current: view === 'all',
    },
    {
      key: 'progress',
      label: 'In progress',
      value: counts.pending,
      hint: counts.pending > 0 ? 'queued or running' : 'nothing running',
      href: '/dashboard?filter=pending',
      icon: <Clock className="h-4 w-4" aria-hidden />,
      tone: counts.pending > 0 ? 'text-warning' : 'text-ink-soft',
      current: view === 'pending',
    },
    {
      key: 'review',
      label: 'Review',
      value: counts.unmatched,
      hint: discovery
        ? 'imports that need your name, and tournaments found on public tabs'
        : 'imports that need your name',
      href: REVIEW_HREF,
      icon: <UserFocus className="h-4 w-4" aria-hidden />,
      tone: counts.unmatched > 0 ? 'text-warning' : 'text-ink-soft',
      current: view === 'review' || view === 'unmatched',
    },
    {
      key: 'done',
      label: 'On record',
      value: counts.done,
      hint: 'imports on your record',
      href: '/dashboard?filter=done',
      icon: <CheckCircle className="h-4 w-4" aria-hidden />,
      tone: 'text-pos',
      current: view === 'done',
    },
  ];

  return (
    <div className="space-y-tight">
      <ol aria-label="Import stages" className="grid grid-cols-2 gap-tight md:grid-cols-4">
        {stages.map((s, i) => (
          <li key={s.key} className="relative min-w-0">
            <Link
              href={s.href}
              // A stage is a view of this page, not a page of its own, so the
              // current one is marked as such (aria-current="true", not "page").
              aria-current={s.current ? 'true' : undefined}
              className={cn(
                'block h-full rounded-card border bg-card p-stack transition-colors duration-150 ease-soft hover:bg-surface-2',
                s.current ? 'border-primary ring-1 ring-primary/25' : 'border-border',
              )}
            >
              <span className="data-label flex items-center gap-1.5">
                <span className={s.tone}>{s.icon}</span>
                <span className="truncate">{s.label}</span>
              </span>
              <span className="figure mt-1.5 block text-figure-md text-ink">{s.value}</span>
              <span className="mt-1 block text-caption text-ink-soft">{s.hint}</span>
            </Link>
            {i < stages.length - 1 ? (
              // The flow arrow, desktop only: on a phone the 2x2 grid has no
              // single reading direction for it to point along.
              <span
                aria-hidden
                className="absolute -right-tight top-1/2 hidden w-tight -translate-y-1/2 text-center text-ink-soft md:block"
              >
                →
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      {counts.failed > 0 || counts.unavailable > 0 ? (
        <p className="text-caption text-ink-soft">
          {counts.failed > 0 ? (
            <>
              <Link
                href="/dashboard?filter=failed"
                className="inline-flex min-h-6 items-center font-medium text-ink underline underline-offset-2 hover:text-primary"
              >
                {counts.failed} failed
              </Link>
              : open them to retry.{' '}
            </>
          ) : null}
          {deadLinksText(counts.unavailable)}
        </p>
      ) : null}
    </div>
  );
}
