import { cn } from '@/lib/utils/cn';

export function BrandMark({ className }: { className?: string }) {
  // Display grotesk, non-italic. The brief calls out decorative italics as
  // an editorial-magazine pattern to avoid for the default personality.
  return (
    <span className={cn('inline-flex items-baseline gap-1', className)}>
      <span className="font-display text-h4 font-semibold tracking-tight text-ink">
        debate
      </span>
      <span className="font-display text-h4 font-semibold tracking-tight text-primary">
        cv
      </span>
    </span>
  );
}
