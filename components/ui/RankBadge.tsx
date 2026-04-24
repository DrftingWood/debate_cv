import { cn } from '@/lib/utils/cn';

/**
 * Tonal rank indicator. 1 = gold/success, 2 = primary blue,
 * 3 = warning amber, 4+ = danger red, null = neutral.
 */
export function RankBadge({ rank, className }: { rank: number | null; className?: string }) {
  if (rank == null) {
    return (
      <span
        className={cn(
          'inline-flex h-6 min-w-6 items-center justify-center rounded-full border border-border bg-muted px-2 text-caption font-semibold text-muted-foreground',
          className,
        )}
      >
        —
      </span>
    );
  }

  const tone =
    rank === 1
      ? 'bg-[hsl(var(--success)/0.12)] text-success border-[hsl(var(--success)/0.28)]'
      : rank === 2
        ? 'bg-primary-soft text-accent-foreground border-primary/25'
        : rank === 3
          ? 'bg-[hsl(var(--warning)/0.14)] text-warning border-[hsl(var(--warning)/0.28)]'
          : 'bg-[hsl(var(--destructive)/0.10)] text-destructive border-[hsl(var(--destructive)/0.24)]';

  return (
    <span
      className={cn(
        'inline-flex h-6 min-w-6 items-center justify-center rounded-full border px-2 text-caption font-semibold',
        tone,
        className,
      )}
      aria-label={`Rank ${rank}`}
    >
      {rank}
    </span>
  );
}
