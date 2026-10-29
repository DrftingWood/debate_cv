import { Skeleton } from '@/components/ui/Skeleton';

/**
 * The first paint of a full page load, before the app's layout (which reads
 * the session) has streamed. It was a bare centred spinner with no header,
 * so every hard load flashed an empty page (owner review 2026-10-29). Now a
 * header-height bar and a content block hold the page's shape.
 */
export default function Loading() {
  return (
    <div className="flex-1">
      <div className="h-[3.75rem] border-b border-border" aria-hidden />
      <div className="mx-auto w-full max-w-(--breakpoint-2xl) space-y-panel px-5 py-8">
        <p role="status" className="sr-only">
          Loading…
        </p>
        <Skeleton className="h-8 w-64 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
    </div>
  );
}
