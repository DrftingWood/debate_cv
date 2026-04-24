import { cn } from '@/lib/utils/cn';

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span
        aria-hidden
        className="inline-flex h-6 w-6 items-center justify-center rounded-md bg-primary-600 text-[11px] font-semibold text-white"
      >
        DC
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-ink-1">debate cv</span>
    </span>
  );
}
