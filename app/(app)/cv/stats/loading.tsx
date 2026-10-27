import { Skeleton } from '@/components/ui/Skeleton';

/**
 * /cv/stats is force-dynamic and does more work than /cv — the field
 * summary pulls every speaker published on every tournament on the record.
 * Without this the route showed a blank frame while that ran.
 *
 * The skeleton mirrors the real layout (header, KPI strip, findings grid,
 * chart pair) so the page doesn't jump when it resolves. Bars that stand for
 * text are `w-full` with a `max-w-*` cap rather than a fixed width: a `w-96`
 * bar is 384 px, wider than the content box of a 390 px phone, and made the
 * page scroll sideways while it loaded (UX-25, UX-39). Skeletons are
 * aria-hidden, so the status line is the only thing a screen reader hears.
 */
export default function CvStatsLoading() {
  return (
    <div className="space-y-8">
      <p role="status" className="sr-only">
        Loading statistics…
      </p>
      <div className="border-b border-border pb-6">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-9 w-full max-w-xs" />
        <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
      </div>

      <Skeleton className="h-9 w-full max-w-sm rounded-lg" />

      <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-border md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className={
              i === 4
                ? 'col-span-2 space-y-2 bg-card px-4 py-4 md:col-span-1'
                : 'space-y-2 bg-card px-4 py-4'
            }
          >
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-7 w-16" />
            <Skeleton className="h-3 w-24" />
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel space-y-2 p-4">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-32" />
          </div>
        ))}
      </div>

      <div className="grid gap-3 lg:grid-cols-[1.6fr_1fr]">
        <Skeleton className="h-56 rounded-card" />
        <Skeleton className="h-56 rounded-card" />
      </div>
    </div>
  );
}
