import { cn } from '@/lib/utils/cn';

/**
 * The mark: a squared emerald tile with a mono "CV" glyph, then the
 * wordmark. Deliberately institution-shaped rather than playful — the
 * product's job is to look like somewhere you would put a real result.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-2', className)}>
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary font-mono text-caption font-semibold text-primary-foreground">
        CV
      </span>
      {/* whitespace-nowrap: in a cramped 320px header row the wordmark broke
          across two lines and pushed the tile out of alignment. */}
      <span className="whitespace-nowrap font-display text-h4 font-medium tracking-tight text-ink">
        debate cv
      </span>
    </span>
  );
}
