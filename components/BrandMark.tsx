import { cn } from '@/lib/utils/cn';

export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span className="grid h-7 w-7 place-items-center rounded-md bg-record-ink font-mono text-caption font-semibold text-archive-white">
        CV
      </span>
      <span className="font-display text-h4 font-semibold tracking-tight text-record-ink">
        debate cv
      </span>
    </span>
  );
}
