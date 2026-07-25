import { Skeleton } from '@/components/ui/Skeleton';

/**
 * Motion archive skeleton — header, summary strip, then a run of motion
 * cards. Same reason as /cv/stats: the route is force-dynamic and was
 * showing a blank frame while buildCvData ran.
 */
export default function CvMotionsLoading() {
  return (
    <div className="space-y-8">
      <div className="border-b border-border pb-6">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="mt-3 h-9 w-80" />
        <Skeleton className="mt-3 h-4 w-full max-w-2xl" />
      </div>

      <Skeleton className="h-9 w-96 rounded-lg" />

      <div className="panel grid grid-cols-2 gap-px overflow-hidden bg-border md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="space-y-2 bg-card px-4 py-4">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-7 w-14" />
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-6 w-64" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="panel space-y-2 p-4">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-5 w-full max-w-3xl" />
            <Skeleton className="h-3 w-52" />
          </div>
        ))}
      </div>
    </div>
  );
}
