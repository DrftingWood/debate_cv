'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, UserSearch } from 'lucide-react';

/**
 * Two transient owner-only banners that surface above the CV table:
 *
 *  1. **Ingesting** — visible whenever the user's IngestJob queue still has
 *     pending or running rows. Auto-refreshes every 8s while pending > 0
 *     so the table fills in row-by-row without the user having to click.
 *  2. **Unmatched** — visible when ≥1 of the user's tournaments couldn't
 *     auto-match them to a speaker/judge. Deep-links to the dashboard's
 *     `Unmatched` filter where the per-row "Find me" search lives.
 *
 * Both are stripped on the public `/u/<slug>` view (those banners are
 * owner-side state, not credential signal).
 */
export function CvNeedsAttentionBanners({
  pendingCount,
  unmatchedCount,
}: {
  pendingCount: number;
  unmatchedCount: number;
}) {
  const router = useRouter();

  useEffect(() => {
    if (pendingCount === 0) return;
    // Server-side `force-dynamic` plus router.refresh() rebuilds the page's
    // server component output; `pendingCount` will fall to 0 once the
    // queue drains, at which point this effect tears down naturally.
    const handle = window.setInterval(() => router.refresh(), 8000);
    return () => window.clearInterval(handle);
  }, [pendingCount, router]);

  if (pendingCount === 0 && unmatchedCount === 0) return null;

  return (
    <div className="space-y-2">
      {pendingCount > 0 ? (
        <div className="flex items-start gap-3 rounded-card border border-warning/30 bg-warning/5 px-4 py-3">
          <Loader2
            className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-warning"
            aria-hidden
          />
          <p className="text-[14px] text-foreground">
            <strong className="font-medium">
              Ingesting {pendingCount} {pendingCount === 1 ? 'tournament' : 'tournaments'}.
            </strong>{' '}
            <span className="text-muted-foreground">
              Rows below will fill in as each finishes.{' '}
              <Link href="/dashboard?filter=pending" className="text-primary hover:underline">
                View queue
              </Link>
              .
            </span>
          </p>
        </div>
      ) : null}
      {unmatchedCount > 0 ? (
        <div className="flex items-start gap-3 rounded-card border border-warning/30 bg-warning/5 px-4 py-3">
          <UserSearch
            className="mt-0.5 h-4 w-4 shrink-0 text-warning"
            aria-hidden
          />
          <p className="text-[14px] text-foreground">
            <strong className="font-medium">
              {unmatchedCount} {unmatchedCount === 1 ? 'tournament needs' : 'tournaments need'} a claim.
            </strong>{' '}
            <span className="text-muted-foreground">
              We ingested them but couldn&apos;t match you to a speaker or judge.{' '}
              <Link
                href="/dashboard?filter=unmatched"
                className="text-primary hover:underline"
              >
                Find yourself on the dashboard
              </Link>
              .
            </span>
          </p>
        </div>
      ) : null}
    </div>
  );
}
