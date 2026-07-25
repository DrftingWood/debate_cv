import { Skeleton } from '@/components/ui/Skeleton';

/**
 * /cv/stats is force-dynamic and does more work than /cv — the field
 * summary pulls every speaker published on every tournament on the record.
 * Without this the route showed a blank frame while that ran.
 *
 * The skeleton mirrors the real layout (header, KPI strip, findings grid,
 * chart pair) so the page doesn't jump when it resolves.
 */
export default function CvStatsLoading() {
  return (
    <div className="space-y-8">
      <div className="border-b border-border pb-6">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-9 w-72" />
        <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
      </div>

      <Skeleton className="h-9 w-96 rounded-lg" />

      <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-border md:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="space-y-2 bg-card px-4 py-4">
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
