import { cn } from '@/lib/utils/cn';

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden
        className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-gradient-accent text-[11px] font-bold text-white shadow-sm"
      >
        DC
      </span>
      <span className="font-display text-[15.5px] font-semibold tracking-tight text-foreground">
        debate cv
      </span>
    </span>
  );
}
