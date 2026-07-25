import * as React from 'react';
import { cn } from '@/lib/utils/cn';

type Variant =
  | 'neutral'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'outline'
  | 'quiet'
  | 'gold';

// Statement-register badges: squared-off, low-saturation fills, mono label.
// A badge here is a data flag (BROKE / ESL / VERIFIED), not decoration, so
// it borrows the same uppercase mono voice as the column headers.
const variants: Record<Variant, string> = {
  neutral: 'bg-surface-2 text-ink-soft border-border',
  success: 'bg-[hsl(var(--pos)/0.10)] text-pos border-[hsl(var(--pos)/0.20)]',
  warning: 'bg-[hsl(var(--warning)/0.10)] text-warning border-[hsl(var(--warning)/0.20)]',
  danger: 'bg-[hsl(var(--neg)/0.10)] text-neg border-[hsl(var(--neg)/0.20)]',
  info: 'bg-score-soft text-score-blue border-[hsl(var(--score-blue)/0.20)]',
  // The one badge allowed to shout: a break is the standout competitive
  // result on a debate CV, and gold is reserved for exactly that.
  gold: 'bg-break-soft text-break-gold border-[hsl(var(--break-gold)/0.22)]',
  outline: 'bg-transparent text-ink border-border',
  quiet: 'bg-transparent text-ink-soft border-transparent px-0 py-0',
};

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> & {
  variant?: Variant;
};

export function Badge({ className, variant = 'neutral', ...rest }: BadgeProps) {
  const isQuiet = variant === 'quiet';
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono text-kicker font-medium uppercase tracking-[0.09em]',
        isQuiet ? '' : 'rounded border px-1.5 py-0.5',
        variants[variant],
        className,
      )}
      {...rest}
    />
  );
}
