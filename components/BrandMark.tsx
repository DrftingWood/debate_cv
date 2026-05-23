import { cn } from '@/lib/utils/cn';

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-baseline gap-1', className)}>
      <span className="font-serif italic text-h4 font-medium tracking-tight text-ink">
        debate
      </span>
      <span className="font-serif italic text-h4 font-medium tracking-tight text-oxblood">
        cv
      </span>
    </span>
  );
}
