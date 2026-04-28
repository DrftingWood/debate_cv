'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Loader2, UserSearch } from 'lucide-react';

/**
 * Two transient owner-only banners that surface above the CV table:
 *
 *  1. **Ingesting** — visible whenever the user's IngestJob queue still has
 *     pending or running rows.
 *  2. **Unmatched** — visible when ≥1 of the user's tournaments couldn't
 *     auto-match them to a speaker/judge. Deep-links to the dashboard's
 *     `Unmatched` filter where the per-row "Find me" search lives.
 *
 * Both are stripped on the public `/u/<slug>` view (owner-side state,
 * not credential signal).
 *
 * Auto-refresh model:
 *
 *  Previously this component called router.refresh() every 8s while
 *  pending > 0. router.refresh() re-runs the entire CV server component —
 *  multiple Prisma queries plus highlights aggregations — which on a heavy
 *  user takes longer than 8s, so requests pile up and the tab feels frozen
 *  during ingest (the user reported this).
 *
 *  Replaced with a cheap GET /api/cv/status poll that returns just
 *  {pendingCount, unmatchedCount} from two COUNT queries. The banner
 *  triggers router.refresh() only when those numbers actually change
 *  (a job completed, an unmatched got claimed). Cost: ~10ms per poll
 *  vs ~hundreds of ms for the full rebuild. Polling stops once pending
 *  hits 0 (no need to keep refreshing a stable CV).
 *
 *  The status counts also drive the live banner copy: the banner
 *  shows the current poll value, not the initial server-render value,
 *  so users see numbers tick down without waiting for a refresh cycle.
 */
export function CvNeedsAttentionBanners({
  pendingCount: initialPending,
  unmatchedCount: initialUnmatched,
}: {
  pendingCount: number;
  unmatchedCount: number;
}) {
  const router = useRouter();
  const [pendingCount, setPendingCount] = useState(initialPending);
  const [unmatchedCount, setUnmatchedCount] = useState(initialUnmatched);
  // Track the last counts we've seen so we know when to fire the
  // (expensive) router.refresh(). Refs (not state) — we don't want a
  // re-render every poll.
  const lastPendingRef = useRef(initialPending);
  const lastUnmatchedRef = useRef(initialUnmatched);

  useEffect(() => {
    // Sync refs to props if the parent rerenders with fresh counts.
    lastPendingRef.current = initialPending;
    lastUnmatchedRef.current = initialUnmatched;
    setPendingCount(initialPending);
    setUnmatchedCount(initialUnmatched);
  }, [initialPending, initialUnmatched]);

  useEffect(() => {
    // Only poll when there's something in flight. Once pending hits 0,
    // the banner has nothing to show progress for and the tear-down keeps
    // the page idle.
    if (pendingCount === 0) return;

    let cancelled = false;
    let inFlight = false;

    const tick = async () => {
      if (cancelled || inFlight) return;
      if (document.visibilityState !== 'visible') return;
      inFlight = true;
      try {
        const res = await fetch('/api/cv/status', { cache: 'no-store' });
        if (!res.ok) return;
        const data = (await res.json()) as { pendingCount: number; unmatchedCount: number };
        if (cancelled) return;
        setPendingCount(data.pendingCount);
        setUnmatchedCount(data.unmatchedCount);
        // Trigger a full server-component refresh ONLY when the numbers
        // changed — that's our signal that there's new data worth
        // rebuilding the CV for. Otherwise stay quiet.
        const changed =
          data.pendingCount !== lastPendingRef.current ||
          data.unmatchedCount !== lastUnmatchedRef.current;
        lastPendingRef.current = data.pendingCount;
        lastUnmatchedRef.current = data.unmatchedCount;
        if (changed) router.refresh();
      } finally {
        inFlight = false;
      }
    };

    const handle = window.setInterval(tick, 8000);
    return () => {
      cancelled = true;
      window.clearInterval(handle);
    };
  }, [pendingCount, router]);

  if (pendingCount === 0 && unmatchedCount === 0) return null;

  return (
    <div className="space-y-2" data-print-hide="true">
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
