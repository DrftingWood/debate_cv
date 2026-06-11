import { cn } from '@/lib/utils/cn';

// Tab Sheet brand (owner ruling D3): the gold break-slash — the mark of an
// earned result — beside the wordmark in expanded Archivo caps. The
// lowercase editorial-era wordmark and the CV-in-a-box glyph died with it.
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <span aria-hidden className="block h-[18px] w-[7px] -skew-x-12 bg-break-gold" />
      <span className="display-expanded font-display text-[16px] font-bold uppercase tracking-[0.06em] text-record-ink">
        Debate CV
      </span>
    </span>
  );
}
