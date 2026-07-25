import { Card } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';

/**
 * /cv/verify is the heaviest server render in the product — every parsed
 * participant, judge assignment and per-round score for every tournament on
 * the record, which measured 41,000px of markup on a seeded account. It was
 * also the only heavy route without a loading file, so the whole wait was a
 * blank white page.
 *
 * The skeleton mirrors the real shape (a stack of per-tournament panels,
 * each with a wide table) so the layout does not jump when the data lands.
 */
export default function VerifyLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-7 w-64" />
        <Skeleton className="h-4 w-96" />
      </div>
      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="p-5">
            <div className="flex items-baseline justify-between">
              <Skeleton className="h-5 w-72" />
              <Skeleton className="h-4 w-20" />
            </div>
            <div className="mt-5 space-y-2">
              {Array.from({ length: 6 }).map((_, j) => (
                <Skeleton key={j} className="h-8 w-full" />
              ))}
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
