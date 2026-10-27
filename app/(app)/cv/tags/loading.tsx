import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';

export default function TagsLoading() {
  return (
    <div className="space-y-6">
      <p role="status" className="sr-only">
        Loading motion tags…
      </p>
      {/* Fluid width with a cap: a fixed w-80 bar (320 px) plus the page
          gutters overflows a 320 px screen (UX-25, UX-39). */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-full max-w-xs" />
      </div>
      <Card className="p-5">
        <div className="space-y-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center justify-between gap-4">
              <Skeleton className="h-4 w-full max-w-xl" />
              <Skeleton className="h-6 w-24 shrink-0" />
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
