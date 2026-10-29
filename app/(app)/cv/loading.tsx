import { Skeleton } from '@/components/ui/Skeleton';

/**
 * The Record's shape while it loads (owner review 2026-10-29: three generic
 * cards stood in for a page of tiles, charts and year groups): the name,
 * two tile pairs over two chart panels, then the tab row and year rules.
 */
export default function CvLoading() {
  return (
    <div className="space-y-8">
      {/* The skeleton blocks are aria-hidden, so without this line a screen
          reader hears nothing at all while the record loads (STATE-4). */}
      <p role="status" className="sr-only">
        Loading your record…
      </p>
      <div className="space-y-2 border-b border-border pb-6">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-10 w-72 max-w-full" />
        <Skeleton className="h-4 w-64 max-w-full" />
      </div>
      <div className="grid gap-group lg:grid-cols-2">
        {[0, 1].map((i) => (
          <div key={i} className="space-y-stack">
            <Skeleton className="h-[5.5rem] w-full" />
            <Skeleton className="h-72 w-full" />
          </div>
        ))}
      </div>
      <div className="space-y-stack">
        <Skeleton className="h-8 w-64" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-baseline justify-between border-t border-ink pt-tight">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-4 w-80 max-w-[60%]" />
          </div>
        ))}
      </div>
    </div>
  );
}
