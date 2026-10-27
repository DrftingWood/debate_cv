import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';

export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="p-4">
            <Skeleton className="mb-2 h-3 w-20" />
            <Skeleton className="h-8 w-12" />
          </Card>
        ))}
      </div>
      {/* The bare /dashboard is the summary: tiles and one "Browse all"
          link. A table skeleton here promised a page that no longer loads. */}
      <Skeleton className="h-5 w-40" />
      <p role="status" className="sr-only">
        Loading imports…
      </p>
    </div>
  );
}
